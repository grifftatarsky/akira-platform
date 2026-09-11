import { Buffer, VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StorageBuffer } from '@babylonjs/core/Buffers/storageBuffer';
import { ComputeShader } from '@babylonjs/core/Compute/computeShader';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { ProceduralTexture } from '@babylonjs/core/Materials/Textures/Procedurals/proceduralTexture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader';
import type { GroundField } from '../ground-field';
import { BladeWind } from './blade-wind';
import { leafTexture, leafThickness } from './leaf-texture';
import { type Plant, MEADOW, plantGeometry } from './species';
import { fieldTexture } from './splat-bake';

/**
 * The meadow, placed on the GPU, one dispatch per species.
 *
 * <p>Every plant's position, facing, lean, height and colour is derived from
 * its own index in a compute pass; nothing crosses back to the CPU and density
 * is a number in a uniform buffer. The species each get their own instance
 * buffers and their own dispatch, because they are different geometry — but
 * they share the shader, so a sixth is a row in a table.
 *
 * <p><b>Clumps decide more than height.</b> Real grass grows in patches that
 * share a cast of colour, a height and — the part that reads most — a
 * direction: plants in a clump splay outward from its middle rather than
 * facing at random. That last one is straight out of the Tsushima talk and it
 * is the difference between a field and a carpet of individually placed
 * blades.
 */

/**
 * Plants in the buffers, across all species. Density scales how many draw.
 *
 * <p>Spread evenly over the board, at one density, at every zoom. The slider
 * scales how many of them draw.
 */
const MAX_PLANTS = 600_000;

/**
 * The lattice every plant stands on covers the whole board, and nothing about
 * it depends on the camera.
 *
 * <p><b>This is a combat board, not a walk through a meadow.</b> Zoomed out,
 * the whole field is in shot and every square foot of it has to be grassed;
 * there is no off-screen to hide thinning in. A window that followed the
 * camera, cells that grew with distance, and a geometry ladder that swapped
 * plants for sticks were all answers to a question this board does not ask.
 * They also had a fault that no frame time would ever have shown: the cell size
 * varied continuously with the camera, a plant's identity hashes from its cell,
 * so every zoom reshuffled the entire field and the grass crawled across the
 * map.
 *
 * <p>So: one pitch, fixed at load, spanning the board. The camera cannot move
 * a plant because the camera is not an input.
 */
/** Half-feet across a clump. About a stride. */
const CLUMP = 11;


const SOW = `
struct Params {
  a: vec4f,   // extentX, extentY, count, seed offset
  b: vec4f,   // tall, wide, wearMax, droop
  c: vec4f,   // damp preference, spare, spare, spare
  d: vec4f,   // plants per cell, cells east, lattice pitch, cells north
  e: vec4f,   // spare
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> matrices: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> tints: array<vec4f>;
@group(0) @binding(3) var groundField: texture_2d<f32>;
@group(0) @binding(4) var heights: texture_2d<f32>;

// An integer hash, not a sine. Sine hashes band visibly at large coordinates
// because they are sampling a smooth function, and a meadow is exactly the
// place where a faint regular pattern is obvious.
fn hashU(seed: u32) -> u32 {
  var h = seed;
  h ^= h >> 16u; h *= 0x7feb352du;
  h ^= h >> 15u; h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}

fn rand(seed: u32) -> f32 {
  return f32(hashU(seed) & 0xffffffu) / 16777216.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= u32(params.a.z)) { return; }

  let extent = params.a.xy;

  // <b>One lattice, spanning the board, fixed at load.</b>
  //
  // <p>A plant's identity hashes from the cell it grows in and its slot in
  // that cell, never from its index — so the same cell always grows the same
  // plant, and a re-sow for a density change rewrites the field identically
  // except for the plants it adds or takes away.
  let slots = max(1u, u32(params.d.x));
  let eastCells = max(1u, u32(params.d.y));
  let northCells = max(1u, u32(params.d.w));
  // Named neither step nor cell. WGSL has a step() builtin that this shader
  // calls further down, and shadowing it turns that call into "cannot use
  // 'let step' as call target"; cell is taken by the clump code below.
  let span = max(0.01, params.d.z);
  let slot = index % slots;
  let cellIndex = index / slots;
  let cx = cellIndex % eastCells;
  let cy = cellIndex / eastCells;
  let gx = f32(cx);
  let gy = f32(cy);

  // Parentheses required: WGSL refuses to mix '*' and '^' without them, and it
  // refuses by failing to parse the whole vertex stage — silently, with a
  // material that still reports itself ready and a field with no grass in it.
  let seed = (u32(i32(gx) + 16384) * 2654435761u)
    ^ (u32(i32(gy) + 16384) * 2246822519u)
    ^ ((slot + u32(params.a.w)) * 3266489917u);
  // <b>Jitter inside the cell, and stagger every other row.</b>
  //
  // <p>A point placed anywhere in its cell is white noise with a grid drawn
  // round it: neighbours land shoulder to shoulder as often as they leave a
  // gap, and the gaps are what the eye finds. Holding the jitter to a fraction
  // of a cell fixes that and trades it for the opposite fault — the lattice
  // itself starts to show, as rows running away across the field.
  //
  // <p>Offsetting alternate rows by half a cell is what breaks it. The lattice
  // becomes triangular rather than square, which has no rows to see down, and
  // it is the same packing a hexagonal grid gives for nothing: every point has
  // six neighbours at one distance instead of four near ones and four far.
  let stagger = f32(u32(abs(gy)) & 1u) * 0.5;
  let inCell = (vec2f(rand(seed), rand(seed + 1u)) - 0.5) * 0.88 + 0.5;
  let where2 = vec2f(gx + stagger, gy) * span + inCell * span;

  // Past the last row, or past the board's own edge after the stagger and the
  // jitter. Zeroed rather than skipped, because this instance is drawn either
  // way and a stale matrix would leave a plant standing in mid-air.
  if (cy >= northCells || where2.x < 0.0 || where2.y < 0.0
      || where2.x >= extent.x || where2.y >= extent.y) {
    let off = index * 4u;
    matrices[off + 0u] = vec4f(0.0);
    matrices[off + 1u] = vec4f(0.0);
    matrices[off + 2u] = vec4f(0.0);
    matrices[off + 3u] = vec4f(0.0, 0.0, 0.0, 1.0);
    tints[index] = vec4f(0.0);
    return;
  }

  // <b>The clump this plant belongs to — the nearest seed point, not the cell
  // it happens to fall in.</b>
  //
  // <p>Keying the clump on the square cell is the same thing as painting the
  // field in squares: the clump decides height and colour, so every eleven
  // half-feet the whole sward changes tone along a straight line, and from
  // directly above — which is this board's camera — it reads as a chequerboard
  // laid over the grass. It is the single most visible artifact on the board at
  // full zoom-out and it is not subtle once seen.
  //
  // <p>So the cells only hold seed points, one jittered inside each, and a
  // plant belongs to whichever seed is nearest. That is a Voronoi diagram: the
  // boundaries are irregular polygons that meet at angles the eye does not
  // recognise as a grid. Nine cells is the whole search, because a seed jittered
  // within its own cell can never be nearer than one two cells away.
  //
  // <p>Everything the clump decides is hashed from that cell, so neighbours
  // agree on it without anything being stored.
  let home = floor(where2 / ${CLUMP.toFixed(1)});
  var nearest = 1e9;
  var clumpCell = home;
  var middle = where2;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let near = home + vec2f(f32(i), f32(j));
      let seedOf = u32(near.x + 977.0) * 3557u + u32(near.y + 977.0) * 6151u;
      let at2 = (near + vec2f(rand(seedOf + 11u), rand(seedOf + 12u)))
        * ${CLUMP.toFixed(1)};
      let away = where2 - at2;
      let far2 = dot(away, away);
      if (far2 < nearest) {
        nearest = far2;
        clumpCell = near;
        middle = at2;
      }
    }
  }
  let clumpSeed = u32(clumpCell.x + 977.0) * 3557u + u32(clumpCell.y + 977.0) * 6151u;
  let clumpTall = 0.62 + 0.76 * rand(clumpSeed);
  let clumpTone = rand(clumpSeed + 7u);

  let size = vec2f(textureDimensions(groundField, 0));
  let texel = vec2i(clamp(where2 / extent, vec2f(0.0), vec2f(1.0)) * (size - 1.0));
  let ground = textureLoad(groundField, texel, 0);
  let wear = ground.r;
  let wet = ground.g;
  let drift = ground.b;

  let hSize = vec2f(textureDimensions(heights, 0));
  let hTexel = vec2i(clamp(where2 / extent, vec2f(0.0), vec2f(1.0)) * (hSize - 1.0));
  let ground_z = textureLoad(heights, hTexel, 0).r;

  // <b>The ground's own normal, sampled a texel either side.</b>
  //
  // <p>Not computed analytically: the height field is what the terrain mesh was
  // built from, so reading it the same way is the only thing that guarantees a
  // plant agrees with the ground it is standing on.
  //
  // <p>This is the normal the plant is shaded by, which is the part that
  // matters. Breath of the Wild copies the terrain's normal straight onto its
  // grass, and Black Ops 4 rotates blade normals by it and falls back to pure
  // terrain normals at distance — two teams arriving there separately. What it
  // replaces here is a hand-tuned fan that lifted every leaf normal toward the
  // sky and then floored it, because a normal pointing at the ground takes the
  // hemispheric light's brown and reads as black. A normal that came from the
  // ground cannot point at it.
  let limit = vec2i(hSize) - vec2i(1);
  let hx0 = textureLoad(heights, clamp(hTexel + vec2i(-1, 0), vec2i(0), limit), 0).r;
  let hx1 = textureLoad(heights, clamp(hTexel + vec2i(1, 0), vec2i(0), limit), 0).r;
  let hy0 = textureLoad(heights, clamp(hTexel + vec2i(0, -1), vec2i(0), limit), 0).r;
  let hy1 = textureLoad(heights, clamp(hTexel + vec2i(0, 1), vec2i(0), limit), 0).r;
  let perTexel = extent / hSize;
  let slope = vec2f((hx1 - hx0) / (2.0 * perTexel.x), (hy1 - hy0) / (2.0 * perTexel.y));
  // Board is x-east, y-north, z-up; the stage is y-up, so the normal swaps the
  // same way every position on this board does.
  let groundN = normalize(vec3f(-slope.x, 1.0, -slope.y));

  // Worn ground has less on it, and each species gives up at its own point —
  // plantain lives on a trodden verge where meadow grass has already gone.
  var alive = 1.0 - smoothstep(params.b.z - 0.2, params.b.z, wear);
  // And some of them care whether it is damp.
  let damp = params.c.x;
  alive *= clamp(1.0 + damp * (wet - 0.35) * 1.6, 0.15, 1.0);
  alive *= step(0.02, alive);

  // <b>Everything scales by alive, not just the height.</b> Scaling only
  // the height leaves a plant that failed the wear test as a flat quad of full
  // width lying on the ground with a zeroed column in its matrix — and a
  // matrix with a zero column has no usable normal, so it shades black. On the
  // grass-only meadow those were slivers nobody saw. A clover leaf is not a
  // sliver: it is a black scrap on the road verge, hundreds of them, exactly
  // where the wear test culled the most. Scaling all three columns makes a
  // culled plant a point with no area at all.
  // One scale, applied to all three columns. The plant's own proportions are
  // already in its geometry, so what is left here is how big this particular
  // one is — and a uniform scale keeps the matrix a rotation as far as a normal
  // is concerned.
  let grow = clumpTall * (0.74 + 0.52 * rand(seed + 2u)) * alive;
  let tall = grow;
  let wide = grow;

  // <b>Facing splays out from the clump.</b> Plants growing together lean away
  // from each other for the light, so a clump is a rosette rather than a
  // scatter — and a field of rosettes reads as growth where a field of random
  // facings reads as a texture.
  let outward = where2 - middle;
  let splay = select(atan2(outward.y, outward.x), rand(seed + 4u) * 6.2831853,
    dot(outward, outward) < 0.02);
  let facing = splay + (rand(seed + 5u) - 0.5) * 1.5;
  let cf = cos(facing);
  let sf = sin(facing);

  // <b>No lean in the matrix.</b> A plant's droop used to be a rigid tilt of
  // the whole instance, which is both wrong — a stem bends, it does not hinge
  // at the root — and expensive in a way that is not obvious: a tilted up
  // column is no longer the ground's normal, and the ground's normal is the
  // one thing the shading wants. Droop is a bend along the blade's length in
  // the vertex shader now, where the wind already bends it, and the matrix is
  // left standing square on the hill.

  // <b>Columns of the world matrix, and they have to be orthogonal.</b>
  //
  // <p>The through column used to be forced horizontal, to stop a leaning
  // plant tipping its normal at the ground. It worked, and it was wrong: with
  // up leaning and through level, through dot up is sin(lean), so the basis is
  // skewed rather than rotated. A skewed matrix mistransforms a normal in
  // exactly the way a non-uniform scale does — and the transformed normal for
  // a leaflet facing the wrong way drops below the horizon and shades black.
  // Which is the defect that survived every other explanation, because every
  // other explanation was about the material and this one is arithmetic.
  //
  // <p>Built from a cross product instead: across and up are already unit and
  // perpendicular, so their cross is the third axis of a true rotation. The
  // normals no longer need the matrix to lie for them — the geometry biases
  // them upward itself.
  // <b>Built on the ground's normal rather than on world up.</b> A plant grows
  // perpendicular to what it is rooted in, so on a slope the whole tuft should
  // lean with the hill — and the lean it has of its own is measured from there,
  // not from vertical. The frame is orthonormal by construction: across is the
  // facing direction projected onto the ground plane, over completes it, and a
  // cross product supplies the third axis, so the matrix stays a rotation and a
  // normal transformed by it stays a normal.
  let flatAcross = vec3f(cf, 0.0, -sf);
  let acrossDir = normalize(flatAcross - groundN * dot(flatAcross, groundN));
  let upDir = groundN;
  let across = acrossDir * wide;
  let up = upDir * tall;
  let through = cross(acrossDir, upDir) * wide;

  let at = index * 4u;
  matrices[at + 0u] = vec4f(across, 0.0);
  matrices[at + 1u] = vec4f(up, 0.0);
  matrices[at + 2u] = vec4f(through, 0.0);
  // Board is x-east, y-north, z-up; the stage is y-up. Same swap as the mesh.
  matrices[at + 3u] = vec4f(where2.x, ground_z, where2.y, 1.0);

  // <b>The clump's colour, not just its brightness.</b> A patch of clover is
  // not a paler version of the patch beside it — it is a different green, and
  // the difference is mostly in how much yellow is in it. One scalar per clump
  // gives a field that varies in exposure; three give one that varies in
  // season, which is what a real sward does from one square yard to the next.
  // <b>How enclosed this plant is, for the root shading to read.</b> A blade
  // in the middle of a thick clump has a foot of its neighbours over it and is
  // dark at the base; one standing alone on a worn verge is lit all the way
  // down. That is the ambient occlusion a sward actually has, and the compute
  // pass already knows both halves of it — how tall the clump grew, and how
  // much of the plant survived the wear test.
  //
  // <p>Screen-space occlusion would need depth and normals in a prepass, which
  // is a second geometry pass over a quarter of a million instances, and
  // geometry is measurably the only thing this board is short of. This costs a
  // multiply and a channel that was being written as 1.0 and ignored.
  let enclosed = clamp(clumpTall * alive * 0.78, 0.0, 1.0);

  let lift = 0.84 + 0.26 * clumpTone + 0.12 * drift + 0.08 * rand(seed + 7u);
  let yellow = 0.88 + 0.34 * rand(clumpSeed + 21u);
  let deep = 0.90 + 0.22 * rand(clumpSeed + 22u);
  tints[index] = vec4f(
    lift * yellow, lift * deep, lift * (0.80 + 0.24 * drift), enclosed);
}
`;

export interface Sown {
  readonly plant: Plant;
  readonly mesh: Mesh;
  readonly wind: BladeWind;
  /** The compute-written instance matrices, so a probe can read them back. */
  readonly matrices: StorageBuffer;
  readonly tints: StorageBuffer;
  count: number;
}

export interface Meadow {
  readonly sown: readonly Sown[];
  /** How many plants are drawn, as a fraction of the buffers. */
  setDensity(fraction: number): void;
  /** Moves the wind. Cheap: one uniform, no dispatch. */
  step(seconds: number): void;
  /** Whether the last sowing actually ran. */
  readonly ran: boolean;
  readonly plants: number;
  dispose(): void;
}

export function sowMeadow(
  field: GroundField, scene: Scene, plants: readonly Plant[] = MEADOW,
): Meadow {
  const engine = scene.getEngine() as WebGPUEngine;
  const heightTexture = heightsAsTexture(field, scene);
  const groundTexture = fieldTexture(field, scene);
  const total = plants.reduce((sum, plant) => sum + plant.share, 0);
  const leaves: ProceduralTexture[] = [];

  // Read as well as write: without it `StorageBuffer.read` never resolves —
  // it does not fail, it simply hangs, and it takes the page's GPU context
  // with it. The buffers are not read in a frame, only by a probe, and the
  // flag costs nothing until one asks.
  const flags = Constants.BUFFER_CREATIONFLAG_STORAGE
    | Constants.BUFFER_CREATIONFLAG_VERTEX
    | Constants.BUFFER_CREATIONFLAG_WRITE
    | Constants.BUFFER_CREATIONFLAG_READ;

  interface Bed {
    readonly sown: Sown;
    readonly matrices: StorageBuffer;
    readonly tints: StorageBuffer;
    readonly params: UniformBuffer;
    readonly compute: ComputeShader;
    readonly cap: number;
    readonly offset: number;
  }

  const beds: Bed[] = [];
  let seedOffset = 0;

  for (const plant of plants) {
    const cap = Math.max(64, Math.round((MAX_PLANTS * plant.share) / total));

    const mesh = new Mesh(`meadow-${plant.id}`, scene);
    // <b>One geometry, at full detail, at every distance.</b> There was a
    // ladder here that coarsened plants as the camera pulled back. On a board
    // that is looked at from above it coarsened the plants in the middle of the
    // shot, which is the only place anybody is looking.
    plantGeometry(plant).applyToMesh(mesh);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.useVertexColors = true;
    // <b>The meadow does not receive shadows either.</b> It did, and the shadow
    // map it was reading contains the terrain and nothing else — so six hundred
    // thousand blades standing up to two feet above the depth that map recorded
    // were each asking whether the *ground* under them was lit. Every one of the
    // three standard biases fails on that: a constant one has to cover a
    // two-foot vertical spread, a slope-scaled one is derived from a receiver
    // whose slope is vertical, and a normal-offset one needs a real geometric
    // normal where every normal in `species.ts` is deliberate fiction.
    //
    // <p>Nobody shadow-maps grass. Fortnite never put it in the map and used
    // screen-space contact shadows instead; Unity's own guidance is that
    // contact shadows alone are a sufficient substitute for grass; *Ghost of
    // Tsushima* raises the terrain to grass height and writes it dithered. This
    // is the cheapest of those — it *removes* a texture fetch and a filtering
    // loop from the most-invoked fragment shader on the board — and what it
    // gives up is grass darkening under a rise, which the bounce light and the
    // root-to-tip ramp were already doing more of than the map was.
    mesh.receiveShadows = false;

    const material = new PBRMaterial(`plant-${plant.id}`, scene);
    material.metallic = 0;
    // <b>Grass is shiny.</b> Counter-intuitively so: individual blades throw
    // hard specular highlights, and the glitter of a field in sun is those
    // highlights at ten thousand random orientations. Measured references put
    // fresh grass near 0.5–0.55 rough, not the 0.78 that was here, and this
    // material was also suppressing the highlight to a quarter strength on top
    // of that — which between them removed the single feature that most says
    // "grass in sunlight" rather than "green surface".
    material.roughness = 0.55;
    material.backFaceCulling = false;
    // <b>Off, deliberately.</b> It flips the normal on a back face, and
    // these normals are authored rather than derived — fanned across the leaf
    // and held above the horizon. Flipping one of those points it at the
    // ground, which is the black that was eating holes in the clover. With it
    // off both sides shade from the same upward normal, which is how a leaf
    // scatters anyway.
    material.twoSidedLighting = false;
    material.albedoColor = new Color3(plant.base[0], plant.base[1], plant.base[2]);
    material.specularIntensity = 1;
    // <b>The leaf's own surface</b>, baked once: veins, a paler midrib,
    // mottling and a dried edge. It also keeps the uv attribute alive, which
    // the wind plugin needs for the height up the plant — without a texture
    // Babylon does not declare it and the shader will not parse.
    const leaf = leafTexture(plant, scene);
    leaves.push(leaf);
    material.albedoTexture = leaf;
    material.useAlphaFromAlbedoTexture = false;
    material.transparencyMode = PBRMaterial.MATERIAL_OPAQUE;
    // The albedo now carries the colour, so the material's own tint would
    // double it.
    material.albedoColor = new Color3(1, 1, 1);
    // <b>Translucency, now reading a thickness map instead of guessing.</b>
    //
    // <p>It was enabled before and it was uniform: every point of every leaf
    // equally translucent, which is the same as none of it being translucent,
    // because the whole effect lives in the variation. A leaf is thin at its
    // edge and its tip where the light comes straight through, and thick along
    // the rib where it does not. `leaf-texture.ts` was already computing that
    // and writing it into the albedo's alpha, where nothing could read it —
    // Babylon's subsurface wants thickness in a texture's red channel.
    //
    // <p>This is the term Angelo Pesce calls the difference between grass and
    // dark grass: "without it, the grass looks way too dark, even with GI".
    material.subSurface.isTranslucencyEnabled = true;
    const thickness = leafThickness(plant, scene);
    leaves.push(thickness);
    material.subSurface.thicknessTexture = thickness;
    // Only thickness is in that texture. With the mask flag on, Babylon would
    // read the green and blue channels as refraction and translucency
    // intensities — and this bake writes thickness into all three.
    material.subSurface.useMaskFromThicknessTexture = false;
    material.subSurface.minimumThickness = 0.05;
    material.subSurface.maximumThickness = 1.1;
    // Measured references put leaf translucency at 0.1-0.3 and *yellowish*. The
    // 0.85 that was here is three times that, and a flat green tint for every
    // species besides: a daisy's petal does not transmit clover green.
    material.subSurface.translucencyIntensity = 0.55;
    material.subSurface.tintColor = new Color3(
      plant.tip[0] * 1.5 + 0.1, plant.tip[1] * 1.35 + 0.1, plant.tip[2] * 0.9,
    );

    const wind = new BladeWind(material);
    wind.strength = 1.35 * plant.stiff;
    // The root-to-tip colour lives in the leaf texture now, so the plugin is
    // left with the part a texture cannot know: how much light reaches the
    // bottom of a sward, which depends on what is standing above it.
    wind.tip = [1, 1, 1];
    wind.floor = 0.34;
    wind.ground = plant.lit;
    // Droop moved out of the instance matrix and into the blade's own bend, so
    // the matrix can keep the ground's normal in its up column. As a lateral
    // reach at the tip rather than an angle, because that is what the bend
    // wants.
    // Radians of curve per unit of stem, so the tip has turned through the
    // species' own droop angle whatever height it grew to.
    wind.droop = plant.droop / plant.tall;
    mesh.material = material;

    const matrices = new StorageBuffer(engine, cap * 16 * 4, flags, `${plant.id}-m`);
    const tints = new StorageBuffer(engine, cap * 4 * 4, flags, `${plant.id}-t`);
    const matrixBuffer = new Buffer(engine, matrices.getBuffer(), false, 16, false, true);
    for (let column = 0; column < 4; column++) {
      mesh.setVerticesBuffer(matrixBuffer.createVertexBuffer(`world${column}`, column * 4, 4));
    }
    const tintBuffer = new Buffer(engine, tints.getBuffer(), false, 4, false, true);
    mesh.setVerticesBuffer(tintBuffer.createVertexBuffer(VertexBuffer.ColorKind, 0, 4));

    const params = new UniformBuffer(engine, undefined, true, `${plant.id}-params`);
    params.addUniform('a', 4);
    params.addUniform('b', 4);
    params.addUniform('c', 4);
    params.addUniform('d', 4);
    params.addUniform('e', 4);

    const compute = new ComputeShader(`sow-${plant.id}`, engine, { computeSource: SOW }, {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        matrices: { group: 0, binding: 1 },
        tints: { group: 0, binding: 2 },
        groundField: { group: 0, binding: 3 },
        heights: { group: 0, binding: 4 },
      },
    });
    compute.setUniformBuffer('params', params);
    compute.setStorageBuffer('matrices', matrices);
    compute.setStorageBuffer('tints', tints);
    compute.setTexture('groundField', groundTexture, false);
    compute.setTexture('heights', heightTexture, false);

    beds.push({
      sown: { plant, mesh, wind, matrices, tints, count: cap },
      matrices, tints, params, compute, cap, offset: seedOffset,
    });
    seedOffset += cap;
  }

  let ran = false;
  let density = 0.5;

  /**
   * The lattice: how many cells across the board, and how big one is.
   *
   * <p>Sized by the rarest species. Plants are laid down as a whole number per
   * cell, so a species that is three per cent of the sward needs the cell count
   * to be under its own share of the budget or it cannot be represented at all
   * — round its slots up to one and there are as many daisies as there is
   * grass. That fixes the cell at about sixteen inches, which gives the grass
   * something like twenty blades in each: enough that a cell reads as a tuft
   * rather than as a grid.
   */
  const rarest = Math.min(...plants.map(plant => plant.share)) / total;
  const pitch = Math.sqrt(
    (field.extentXHalfFeet * field.extentYHalfFeet) / (MAX_PLANTS * rarest));
  const eastCells = Math.max(1, Math.ceil(field.extentXHalfFeet / pitch));
  const northCells = Math.max(1, Math.ceil(field.extentYHalfFeet / pitch));
  const cells = eastCells * northCells;

  const sow = (): void => {
    let all = true;
    for (const bed of beds) {
      // Density scales the plants per cell rather than the plant count, so
      // thinning is uniform across the window instead of emptying the cells
      // that happen to sit at the end of the buffer.
      const slots = Math.max(1, Math.floor((bed.cap * density) / cells));
      const count = Math.min(bed.cap, slots * cells);
      bed.sown.count = count;
      bed.sown.mesh.forcedInstanceCount = count;
      bed.params.updateFloat4(
        'a', field.extentXHalfFeet, field.extentYHalfFeet, count, bed.offset,
      );
      bed.params.updateFloat4(
        'b', 1, 1, bed.sown.plant.wearMax, bed.sown.plant.droop,
      );
      bed.params.updateFloat4('c', bed.sown.plant.damp, 0, 0, 0);
      bed.params.updateFloat4('d', slots, eastCells, pitch, northCells);
      bed.params.updateFloat4('e', 0, 0, 0, 0);
      bed.params.update();
      all = bed.compute.dispatch(Math.ceil(Math.max(1, count) / 64)) && all;
    }
    ran = all;
  };
  sow();

  return {
    sown: beds.map(bed => bed.sown),
    plants: MAX_PLANTS,
    get ran(): boolean { return ran; },
    setDensity(fraction: number): void {
      density = Math.max(0, Math.min(1, fraction));
      // Re-sows. The compute pass writes exactly `count` matrices and the rest
      // of the buffer is zeros, so raising the density without this draws
      // instances that were never placed — invisible, so the slider appears to
      // do nothing while every measurement counts plants that do not exist.
      sow();
    },
    step(seconds: number): void {
      for (const bed of beds) {
        bed.sown.wind.time = seconds;
      }
      if (!ran) {
        // A compute effect compiles asynchronously and `dispatch` returns
        // false until it is ready, so the sowing at construction never runs.
        sow();
      }
    },
    dispose(): void {
      for (const bed of beds) {
        bed.sown.mesh.dispose();
        bed.matrices.dispose();
        bed.tints.dispose();
        bed.params.dispose();
      }
      heightTexture.dispose();
      groundTexture.dispose();
      leaves.forEach(leaf => leaf.dispose());
    },
  };
}

/**
 * The height field as something a compute shader can read.
 *
 * <p>Read with `textureLoad` rather than sampled, so it needs no filtering —
 * which matters, because filtering a 32-bit float texture is a WebGPU device
 * feature that is not always there, and a plant a texel out of place is not a
 * plant anybody can see.
 */
function heightsAsTexture(field: GroundField, scene: Scene): RawTexture {
  return new RawTexture(
    field.heights, field.width, field.height,
    Constants.TEXTUREFORMAT_R, scene, false, false,
    Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
  );
}

export { MAX_PLANTS };
