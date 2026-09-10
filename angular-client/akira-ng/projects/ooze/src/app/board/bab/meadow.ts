import { Buffer, VertexBuffer } from '@babylonjs/core/Buffers/buffer';
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

/** Plants in the buffers, across all species. Density scales how many draw. */
const MAX_PLANTS = 600_000;

/** Half-feet across a clump. About a stride. */
const CLUMP = 11;

const SOW = `
struct Params {
  a: vec4f,   // extentX, extentY, count, seed offset
  b: vec4f,   // tall, wide, wearMax, droop
  c: vec4f,   // damp preference, spare, spare, spare
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

  // Position from the index alone, offset per species so two species never
  // stack on the same spot. No lattice, so no lattice to see.
  let seed = (index + u32(params.a.w)) * 5u;
  let where2 = vec2f(rand(seed), rand(seed + 1u)) * extent;

  // The clump this plant belongs to, and where its middle is. Everything the
  // clump decides is hashed from the cell, so neighbours agree without
  // anything being stored.
  let cell = floor(where2 / ${CLUMP.toFixed(1)});
  let clumpSeed = u32(cell.x + 977.0) * 3557u + u32(cell.y + 977.0) * 6151u;
  let middle = (cell + vec2f(rand(clumpSeed + 11u), rand(clumpSeed + 12u))) * ${CLUMP.toFixed(1)};
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

  // Worn ground has less on it, and each species gives up at its own point —
  // plantain lives on a trodden verge where meadow grass has already gone.
  var alive = 1.0 - smoothstep(params.b.z - 0.2, params.b.z, wear);
  // And some of them care whether it is damp.
  let damp = params.c.x;
  alive *= clamp(1.0 + damp * (wet - 0.35) * 1.6, 0.15, 1.0);
  alive *= step(0.02, alive);

  let tall = params.b.x * clumpTall * (0.72 + 0.56 * rand(seed + 2u)) * alive;
  let wide = params.b.y * (0.82 + 0.36 * rand(seed + 3u));

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

  // Its own droop, and nothing to do with the wind — that bends the plant
  // along its length in the vertex shader.
  let lean = params.b.w * (0.25 + 0.75 * rand(seed + 6u));
  let cl = cos(lean);
  let sl = sin(lean);

  // Columns of the world matrix. The through column stays horizontal: it is
  // the one the normal rides on, and tipping it toward the ground turns a
  // bent plant away from the sun and black.
  let across = vec3f(cf, 0.0, -sf) * wide;
  let up = vec3f(sf * sl, cl, cf * sl) * tall;
  let through = vec3f(sf, 0.0, cf) * wide;

  let at = index * 4u;
  matrices[at + 0u] = vec4f(across, 0.0);
  matrices[at + 1u] = vec4f(up, 0.0);
  matrices[at + 2u] = vec4f(through, 0.0);
  // Board is x-east, y-north, z-up; the stage is y-up. Same swap as the mesh.
  matrices[at + 3u] = vec4f(where2.x, ground_z, where2.y, 1.0);

  // The clump's cast, the board's slow drift, and a little of the plant's own.
  let lift = 0.82 + 0.36 * clumpTone + 0.14 * drift + 0.1 * rand(seed + 7u);
  tints[index] = vec4f(vec3f(lift), 1.0);
}
`;

export interface Sown {
  readonly plant: Plant;
  readonly mesh: Mesh;
  readonly wind: BladeWind;
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
  // One white texel. It exists so Babylon declares the uv attribute, which the
  // wind plugin reads for the height up the plant; without a texture there is
  // no uv, and without the uv the shader does not parse.
  const keepUv = RawTexture.CreateRGBATexture(
    new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false,
    Texture.NEAREST_SAMPLINGMODE,
  );

  const flags = Constants.BUFFER_CREATIONFLAG_STORAGE
    | Constants.BUFFER_CREATIONFLAG_VERTEX
    | Constants.BUFFER_CREATIONFLAG_WRITE;

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
    plantGeometry(plant).applyToMesh(mesh);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.useVertexColors = true;
    mesh.receiveShadows = true;

    const material = new PBRMaterial(`plant-${plant.id}`, scene);
    material.metallic = 0;
    material.roughness = 0.78;
    material.backFaceCulling = false;
    // <b>Off, deliberately.</b> It flips the normal on a back face, and
    // these normals are authored rather than derived — fanned across the leaf
    // and held above the horizon. Flipping one of those points it at the
    // ground, which is the black that was eating holes in the clover. With it
    // off both sides shade from the same upward normal, which is how a leaf
    // scatters anyway.
    material.twoSidedLighting = false;
    material.albedoColor = new Color3(plant.base[0], plant.base[1], plant.base[2]);
    material.specularIntensity = 0.25;
    material.albedoTexture = keepUv;
    // Translucency, in the box: the Crysis approximation the old renderer
    // spelled out by hand, except supported and interacting correctly with
    // everything else the material does.
    material.subSurface.isTranslucencyEnabled = true;
    material.subSurface.translucencyIntensity = 0.85;
    material.subSurface.minimumThickness = 0.1;
    material.subSurface.maximumThickness = 0.6;
    material.subSurface.tintColor = new Color3(0.42, 0.72, 0.24);

    const wind = new BladeWind(material);
    wind.strength = 1.35 * plant.stiff;
    wind.tip = [
      plant.tip[0] / Math.max(0.01, plant.base[0]),
      plant.tip[1] / Math.max(0.01, plant.base[1]),
      plant.tip[2] / Math.max(0.01, plant.base[2]),
    ];
    wind.floor = 0.3;
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
      sown: { plant, mesh, wind, count: cap },
      matrices, tints, params, compute, cap, offset: seedOffset,
    });
    seedOffset += cap;
  }

  let ran = false;
  let density = 0.5;

  const sow = (): void => {
    let all = true;
    for (const bed of beds) {
      const count = Math.max(0, Math.round(bed.cap * density));
      bed.sown.count = count;
      bed.sown.mesh.forcedInstanceCount = count;
      bed.params.updateFloat4(
        'a', field.extentXHalfFeet, field.extentYHalfFeet, count, bed.offset,
      );
      bed.params.updateFloat4(
        'b', bed.sown.plant.tall, bed.sown.plant.wide,
        bed.sown.plant.wearMax, bed.sown.plant.droop,
      );
      bed.params.updateFloat4('c', bed.sown.plant.damp, 0, 0, 0);
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
      keepUv.dispose();
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
