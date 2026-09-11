import { Buffer, VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { WebGPUDataBuffer } from '@babylonjs/core/Meshes/WebGPU/webgpuDataBuffer';
import { StorageBuffer } from '@babylonjs/core/Buffers/storageBuffer';
import { ComputeShader } from '@babylonjs/core/Compute/computeShader';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader';
import type { GroundField } from '../ground-field';
import { BladeWind } from './blade-wind';
import { cardGeometry, type FoliageSheet } from './foliage-cards';
import { type Plant, MEADOW } from './species';
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
 *
 * <p><b>Fewer than it was, because a plant is more than it was.</b> A modelled
 * plant was one leaf shape; a card carries the scan of three or four blades at
 * once, so the same number of instances is three or four times the sward. Six
 * hundred thousand of them was a mat you could not see the ground through, and
 * it cost what that implies.
 */
const MAX_PLANTS = 340_000;

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


/**
 * Copies a species' surviving count into its draw's own instance count.
 *
 * <p>One thread, every frame. <b>Every frame, because the engine writes that
 * field too.</b> Babylon already draws an instanced mesh indirectly and fills
 * the argument buffer from the CPU with the mesh's instance count; it skips the
 * write when the count has not changed, which is almost always, but it does
 * write on the first draw of a context and on any change. Publishing from a
 * one-thread dispatch is cheaper than reasoning about when that happens.
 *
 * <p>The layout is WebGPU's own: index count, instance count, first index,
 * base vertex, first instance. Only the second word belongs to us.
 */
const PUBLISH = `
@group(0) @binding(0) var<storage, read_write> tally: array<u32>;
@group(0) @binding(1) var<storage, read_write> draws: array<u32>;

@compute @workgroup_size(1)
fn main() {
  draws[1] = tally[0];
}
`;

const SOW = `
struct Params {
  a: vec4f,   // extentX, extentY, count, seed offset
  b: vec4f,   // tall, wide, wearMax, droop
  c: vec4f,   // damp preference, spare, spare, spare
  d: vec4f,   // plants per cell, cells east, lattice pitch, cells north
  e: vec4f,   // my index, how many species, my share, how far I may crowd
  kinds: array<vec4f, 8>,   // per species: share, drift frequency, clumping
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> matrices: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> tints: array<vec4f>;
@group(0) @binding(3) var groundField: texture_2d<f32>;
@group(0) @binding(4) var heights: texture_2d<f32>;
// How many of this species survived. One counter, incremented once per plant
// that is actually going to be drawn.
@group(0) @binding(5) var<storage, read_write> tally: array<atomic<u32>>;

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

fn hash2f(p: vec2f) -> f32 {
  let q = fract(p * vec2f(0.1031, 0.1030));
  let r = q + dot(q, q.yx + 33.33);
  return fract((r.x + r.y) * r.x);
}

/**
 * Value noise, smoothed. One octave and no more: a drift is a slow change in
 * the odds across tens of feet, and octaves on top of that are detail nobody
 * reads at the scale a drift lives at.
 */
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let w = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2f(i), hash2f(i + vec2f(1.0, 0.0)), w.x),
    mix(hash2f(i + vec2f(0.0, 1.0)), hash2f(i + vec2f(1.0, 1.0)), w.x), w.y);
}

/**
 * One species' drift field at a point.
 *
 * <p>Stretched away from its middle, because value noise piles up around a half
 * and a field that never reaches either end cannot make a species absent.
 */
fn driftAt(where2: vec2f, kind: u32) -> f32 {
  let k = params.kinds[kind];
  let salt = f32(kind);
  let raw = vnoise(where2 * k.y + vec2f(salt * 37.3, salt * 91.7));
  return clamp((raw - 0.5) * 1.9 + 0.5, 0.0, 1.0);
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
  // jitter. Simply not counted: nothing downstream will look at this slot,
  // because the draw's instance count comes from the tally below.
  if (cy >= northCells || where2.x < 0.0 || where2.y < 0.0
      || where2.x >= extent.x || where2.y >= extent.y) {
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

  // <b>Species drift; they do not mix evenly.</b>
  //
  // <p>Taking each plant from the table by its share puts one daisy in every
  // twentieth spot, everywhere, and a thing that is evenly everywhere is a
  // texture rather than a population. Every species carries its own slow field
  // instead, and this asks how much more or less of itself this spot is worth
  // than its average — its own weight over the whole mixture's, against the
  // share it would have had if nothing drifted.
  //
  // <p><b>The normalisation across species is the half that matters.</b>
  // Thickening a species on its own field alone makes five independent
  // scatters that happen to be lumpy. Dividing by the total is what makes them
  // trade: where the daisies come in, the grass between them thins, which is
  // what a drift actually is — a shift in the odds, not a change of surface.
  // Taking the strongest species outright was tried in the renderer this came
  // from and gave solid mats: white sheets laid over the field instead of
  // daisies standing in it.
  let kinds = max(1u, u32(params.e.y));
  var total = 0.0;
  var mine = 0.0;
  for (var k = 0u; k < kinds; k++) {
    let entry = params.kinds[k];
    // The raised field's mean is one over clumping-plus-one, so multiplying it
    // back keeps a species' average weight equal to its share however hard it
    // clumps — otherwise turning the clumping up would quietly delete it.
    let weight = entry.x * pow(driftAt(where2, k), entry.z) * (entry.z + 1.0);
    total += weight;
    if (k == u32(params.e.x)) {
      mine = weight;
    }
  }
  let share = max(0.0001, params.e.z);
  let crowd = max(1.0, params.e.w);
  // Slots were handed out at a multiple of this species share so a drift has
  // room to thicken rather than only thin; the surplus is culled back out here.
  let relative = select(0.0, (mine / total) / share, total > 0.0);
  alive *= step(rand(seed + 9u), clamp(relative, 0.0, crowd) / crowd);
  if (alive < 0.02) {
    return;
  }

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
  // <b>The sward has its own relief, and without it the field has no light in
  // it from above.</b>
  //
  // <p>Every plant is built on the ground's normal, which is the right thing
  // and has one consequence nobody notices until the camera is overhead: on
  // level ground every plant on the board shares one normal, so the sun lights
  // the entire meadow identically and a hundred acres read as a single flat
  // green. Contrast in the tone curve hides it; it does not fix it, because
  // there is nothing there to be in contrast with.
  //
  // <p>A real sward is not level. It rises and falls a hand's width every few
  // paces — tussocks, hollows, the drag of the last thing that walked through —
  // and that relief is what the light picks out from above. So a slow field,
  // finer than the terrain's and coarser than a clump's, tilts the axis every
  // plant grows on. Neighbours agree on it, because they read the same field,
  // which is what makes it read as ground rather than as noise; and it tilts
  // the whole frame rather than only the shading normal, so the tufts lean into
  // their hollows and the silhouette gets the same relief the lighting does.
  let swept = 0.055;
  let here = vnoise(where2 * swept);
  let eastward = vnoise((where2 + vec2f(1.4, 0.0)) * swept);
  let northward = vnoise((where2 + vec2f(0.0, 1.4)) * swept);
  let relief = vec3f(here - eastward, 0.0, here - northward) * 2.6;
  let swardN = normalize(groundN + relief);

  let flatAcross = vec3f(cf, 0.0, -sf);
  let acrossDir = normalize(flatAcross - swardN * dot(flatAcross, swardN));
  let upDir = swardN;
  let across = acrossDir * wide;
  let up = upDir * tall;
  let through = cross(acrossDir, upDir) * wide;

  // <b>Compacted, so what is drawn is what survived.</b>
  //
  // <p>A species is given more slots than its share so its drift has room to
  // thicken, and most of that surplus loses. Those losers used to be written as
  // a zeroed matrix and submitted anyway — a degenerate instance costs no
  // fragments but still costs its setup, and at four hundred thousand of them
  // that is a bill for plants nobody can see. So a survivor takes the next free
  // slot from a counter instead, the survivors end up in a contiguous prefix of
  // the buffer, and the draw's instance count is read from that counter on the
  // GPU rather than handed down from the CPU.
  //
  // <p>The order they land in is whatever the scheduler gives, which is fine:
  // every plant's identity comes from the lattice cell it grew in, never from
  // where it sits in the buffer.
  let at = atomicAdd(&tally[0], 1u) * 4u;
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

  // <b>A drift changes the colour of a stand, not only what is standing in
  // it.</b> The fields already decide where each species thickens; a bank of
  // grass that is winning is also a bank of grass that is greener, because it
  // is the same soil and the same water that made it win. Sampling this
  // species' own field again for hue costs one noise lookup and turns five
  // scattered populations into five that read as places.
  //
  // <p>Two directions from one number, deliberately: where it is high the
  // sward goes deeper and bluer, where it is low it goes yellow and dry. That
  // is the axis a real July field varies along — not brightness, which is what
  // one scalar per clump was giving and what made the whole board read as one
  // green under uneven light.
  let vigour = driftAt(where2, u32(params.e.x));
  let lift = 0.84 + 0.26 * clumpTone + 0.12 * drift + 0.08 * rand(seed + 7u)
    + 0.10 * (vigour - 0.5);
  let yellow = 0.88 + 0.34 * rand(clumpSeed + 21u) - 0.30 * (vigour - 0.5);
  let deep = 0.90 + 0.22 * rand(clumpSeed + 22u) + 0.26 * (vigour - 0.5);
  tints[at / 4u] = vec4f(
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
  /** How many survived the drift, written by the compute pass. */
  readonly tally: StorageBuffer;
  /** Slots dispatched. What is drawn is the tally, not this. */
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
  field: GroundField, scene: Scene, sheet: FoliageSheet,
  plants: readonly Plant[] = MEADOW,
): Meadow {
  const engine = scene.getEngine() as WebGPUEngine;
  const heightTexture = heightsAsTexture(field, scene);
  const groundTexture = fieldTexture(field, scene);
  const total = plants.reduce((sum, plant) => sum + plant.share, 0);

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
    /** How many of this species survived the drift, written by the sowing. */
    readonly tally: StorageBuffer;
    /** Copies that count into the draw's instance count, on the GPU. */
    readonly publish: ComputeShader;
    /** Whether the draw's own argument buffer has been handed to `publish`. */
    wired: boolean;
    /** Frames left to re-publish the count for. See `step`. */
    announce: number;
    readonly cap: number;
    readonly offset: number;
    /** Its row in the species table the drift weighting reads. */
    readonly kind: number;
  }

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

  const beds: Bed[] = [];
  let seedOffset = 0;

  // The whole mixture, as the compute pass reads it: one vec4 a species,
  // holding its share of the meadow, how big its drifts are, and how hard it
  // gathers into them. Every bed gets the same table, because a species cannot
  // know how much of a spot it is worth without knowing what else wants it.
  const kinds = new Float32Array(32);
  plants.forEach((plant, at) => {
    kinds[at * 4 + 0] = plant.share / total;
    kinds[at * 4 + 1] = plant.patch;
    kinds[at * 4 + 2] = plant.clumping;
  });

  for (const plant of plants) {
    // <b>A whole number of slots over the whole lattice.</b> The buffer used
    // to be sized from the share alone while the slots were multiplied by the
    // crowd — so the dispatch was clamped to the buffer and simply stopped part
    // way down the lattice, leaving the last third of the board with nothing
    // growing on it. A bald quarter of a field is not subtle and it took a
    // read-back of the matrices to see it was arithmetic rather than the drift.
    const wanted = (MAX_PLANTS * plant.share * plant.crowd) / total;
    const slotsFull = Math.max(1, Math.round(wanted / cells));
    const cap = slotsFull * cells;

    const mesh = new Mesh(`meadow-${plant.id}`, scene);
    // <b>One geometry, at full detail, at every distance.</b> There was a
    // ladder here that coarsened plants as the camera pulled back. On a board
    // that is looked at from above it coarsened the plants in the middle of the
    // shot, which is the only place anybody is looking.
    cardGeometry(plant, sheet).applyToMesh(mesh);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.useVertexColors = true;
    // <b>The meadow does not receive shadows, and it was tried again.</b>
    //
    // <p>The original reason was that the shadow map held only terrain at ground
    // level, so every blade standing two feet above that depth asked whether the
    // ground under it was lit, which it always was. That reason is gone — the
    // map holds the sward proxy now, the terrain raised to the height the grass
    // reaches — so it was worth another measurement.
    //
    // <p>It costs 3.3 ms of a 12.9 ms frame and it brings acne: a proxy surface
    // sitting at the same height as the blades standing on it is exactly the
    // configuration a depth bias cannot win, and at a low sun the field fills
    // with faint diagonal banding. Two cascades over four hundred units cannot
    // resolve a blade of grass, and a proxy fine enough to try would be a
    // second field in the shadow map.
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
    // <b>The sheet of scanned cut-outs.</b> One texture for every species, so
    // the meadow is five draws of one material rather than five materials — and
    // so a plant can mix sources, which a daisy does: a scanned flower head over
    // scanned basal leaves, out of two different packs.
    material.albedoTexture = sheet.texture;
    material.albedoColor = new Color3(1, 1, 1);

    // <b>Cut out, not blended.</b> A card is mostly empty and the emptiness has
    // to disappear rather than be sorted: a quarter of a million overlapping
    // transparent quads has no correct draw order, and alpha blending them would
    // cost a sort that cannot be done and still look wrong. A cutout is a
    // discard, needs no order, and writes depth like anything else.
    material.useAlphaFromAlbedoTexture = true;
    material.transparencyMode = PBRMaterial.MATERIAL_ALPHATEST;
    // Low, because the bleed in the packer means the colour just outside the
    // silhouette is the leaf's own — so a generous cutoff keeps the fringe of
    // half-covered texels that reads as a soft edge, instead of the stair-step a
    // high one gives.
    material.alphaCutOff = 0.28;
    // <b>Both faces lit from the same normal.</b> A card has one side and is
    // seen from both; flipping the normal on the back points it at the ground,
    // and a normal under the horizon takes the hemispheric light's brown.
    material.twoSidedLighting = false;

    // <b>Translucency, flat across the card.</b> It used to read a thickness
    // map baked beside the procedural leaf, which is gone with the leaf. A scan
    // carries its own thin edges in the colour, and the term that matters is
    // the one Angelo Pesce calls the difference between grass and dark grass —
    // that low sun comes through a leaf at all.
    material.subSurface.isTranslucencyEnabled = true;
    material.subSurface.minimumThickness = 0.1;
    material.subSurface.maximumThickness = 0.6;
    material.subSurface.translucencyIntensity = 0.55;
    material.subSurface.tintColor = new Color3(
      plant.tip[0] * 1.5 + 0.1, plant.tip[1] * 1.35 + 0.1, plant.tip[2] * 0.9,
    );

    // <b>No image-based lighting on the meadow, and it is 2.2 ms of a 7.1 ms
    // field.</b>
    //
    // <p>The sky probe lights this board through `scene.environmentTexture`, and
    // a PBR material with no reflection of its own falls back to it — so every
    // fragment of every card runs the whole irradiance-and-reflection path for
    // an ambient term sitting at 0.14. Measured from directly above, where the
    // sward covers the screen and is several cards deep over every pixel, that
    // costs more than the sun, the bounce light, the hemisphere and the
    // specular highlight put together.
    //
    // <p>There is no flag for it. `environmentIntensity = 0` changes a uniform
    // and saves nothing, because the code still runs; the fallback is in
    // `_getReflectionTexture`, and the honest way to opt one material out is to
    // answer that question differently for this one. Done before the first
    // compile, so the define is simply never set.
    //
    // <p>What replaces it is the hemisphere, which is what an overcast sky
    // actually is and costs 0.26 ms for the whole field.
    (material as unknown as { _getReflectionTexture(): null })
      ._getReflectionTexture = () => null;

    // <b>The meadow is not fogged, and the ground under it is.</b>
    //
    // <p>Fog measured 1.5 ms of a 7.1 ms field, which is more than the sun
    // costs: it is a per-fragment term and the sward is several cards deep over
    // every pixel from above, so it is paid once a layer. The terrain keeps it —
    // one surface, one fragment a pixel, and the far edge of the board still
    // needs to dissolve. What the grass loses is a wash it was being given on
    // top of ground that already had it.
    material.fogEnabled = false;

    const wind = new BladeWind(material);
    wind.tall = plant.tall;
    // <b>Gentler than it was.</b> The old strength leaned a blade most of its
    // own height downwind, which on a field of cards reads as a combed carpet —
    // every plant agreeing, because they all read the same gust field. The
    // variation between neighbours is the thing that makes wind look like wind,
    // and it lives in the gust's own noise rather than in the amplitude.
    wind.strength = 0.62 * plant.stiff;
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
    params.addUniform('kinds', 4, 8);

    // Four bytes, and they have to be readable back so the probe can say how
    // many plants are actually standing.
    const tally = new StorageBuffer(
      engine, 4,
      Constants.BUFFER_CREATIONFLAG_STORAGE
      | Constants.BUFFER_CREATIONFLAG_WRITE
      | Constants.BUFFER_CREATIONFLAG_READ,
    );

    const compute = new ComputeShader(`sow-${plant.id}`, engine, { computeSource: SOW }, {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        matrices: { group: 0, binding: 1 },
        tints: { group: 0, binding: 2 },
        groundField: { group: 0, binding: 3 },
        heights: { group: 0, binding: 4 },
        tally: { group: 0, binding: 5 },
      },
    });
    compute.setUniformBuffer('params', params);
    compute.setStorageBuffer('matrices', matrices);
    compute.setStorageBuffer('tints', tints);
    compute.setTexture('groundField', groundTexture, false);
    compute.setTexture('heights', heightTexture, false);
    compute.setStorageBuffer('tally', tally);

    const publish = new ComputeShader(
      `publish-${plant.id}`, engine, { computeSource: PUBLISH },
      { bindingsMapping: { tally: { group: 0, binding: 0 }, draws: { group: 0, binding: 1 } } },
    );
    publish.setStorageBuffer('tally', tally);

    beds.push({
      sown: { plant, mesh, wind, matrices, tints, tally, count: cap },
      matrices, tints, params, compute, cap, offset: seedOffset,
      kind: beds.length, tally, publish, wired: false, announce: 0,
    });
    seedOffset += cap;
  }

  let ran = false;
  let density = 0.5;


  const sow = (): void => {
    let all = true;
    for (const bed of beds) {
      // Density scales the plants per cell rather than the plant count, so
      // thinning is uniform across the window instead of emptying the cells
      // that happen to sit at the end of the buffer.
      const slots = Math.max(1, Math.floor((bed.cap * density) / cells));
      const count = Math.min(bed.cap, slots * cells);
      bed.sown.count = count;
      // <b>The mesh is told its ceiling, not its count.</b> Babylon writes the
      // instance count into the draw's argument buffer from here, and skips the
      // write whenever the number has not changed — so a constant ceiling means
      // it writes once and the GPU's own count, published below, is what stands
      // from then on. Handing it the real count would have the CPU and the
      // compute pass fighting over the same four bytes every frame.
      bed.sown.mesh.forcedInstanceCount = bed.cap;
      // Nothing has survived yet this sowing, and the new count has to be
      // announced to the draw once the dispatch below has produced it.
      bed.tally.update(new Uint32Array([0]));
      bed.announce = 3;
      bed.params.updateFloat4(
        'a', field.extentXHalfFeet, field.extentYHalfFeet, count, bed.offset,
      );
      bed.params.updateFloat4(
        'b', 1, 1, bed.sown.plant.wearMax, bed.sown.plant.droop,
      );
      bed.params.updateFloat4('c', bed.sown.plant.damp, 0, 0, 0);
      bed.params.updateFloat4('d', slots, eastCells, pitch, northCells);
      bed.params.updateFloat4(
        'e', bed.kind, plants.length, bed.sown.plant.share / total,
        bed.sown.plant.crowd,
      );
      bed.params.updateFloatArray('kinds', kinds);
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
        // <b>Wired on the first frame it can be.</b> The draw's argument buffer
        // is created by the engine when the mesh is first drawn — there is no
        // draw context before that, and nothing to hand the compute pass.
        if (!bed.wired) {
          const args = indirectArgs(bed.sown.mesh);
          if (args) {
            bed.publish.setStorageBuffer('draws', new WebGPUDataBuffer(args, 20));
            bed.wired = true;
            bed.announce = 3;
          }
        }
        // <b>Only after a sowing, and then only for a frame or two.</b>
        //
        // <p>This ran every frame, and it cost more than the half of the
        // meadow it was saving: five compute dispatches a frame is five pass
        // begins, five pipeline binds and five barriers, which measured 1.2 ms
        // against 1.4 ms of instances removed. A whole optimisation, net
        // negative, and only a wall clock would ever have said so.
        //
        // <p>It does not need to run every frame. The engine writes the
        // instance count into the argument buffer on a draw context's first
        // draw and then skips the write while the count it is asked for does
        // not change — and the count it is asked for is the mesh's fixed
        // ceiling. So a handful of frames after each sowing is enough to be
        // sure ours is the last word, and after that nobody touches it.
        if (bed.wired && bed.announce > 0) {
          bed.publish.dispatch(1);
          bed.announce--;
        }
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
        bed.tally.dispose();
        bed.matrices.dispose();
        bed.tints.dispose();
        bed.params.dispose();
      }
      heightTexture.dispose();
      groundTexture.dispose();
    },
  };
}

/**
 * The buffer WebGPU reads a draw's arguments out of, for this mesh.
 *
 * <p>Babylon already draws every instanced mesh indirectly — it creates this
 * buffer with the draw context and fills it from the CPU. Reaching into it is
 * what lets the compute pass own the instance count instead, and it only exists
 * once the mesh has been drawn: the draw wrapper is keyed on the render pass,
 * and there is no pass until something renders.
 */
function indirectArgs(mesh: Mesh): GPUBuffer | undefined {
  const sub = mesh.subMeshes?.[0] as unknown as {
    _getDrawWrapper?: () => { drawContext?: { indirectDrawBuffer?: GPUBuffer } } | undefined;
  } | undefined;
  return sub?._getDrawWrapper?.()?.drawContext?.indirectDrawBuffer;
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
