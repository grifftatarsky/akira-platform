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
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect: teaches WebGPUEngine how to make a compute context. Babylon
// splits every optional capability into a `.pure` half that is tree-shakable
// and a half that patches the engine prototype, and importing only the class
// gets you `e.createComputeContext is not a function` at the first dispatch.
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader';
import type { GroundField } from '../ground-field';
import { fieldTexture } from './splat-bake';

/**
 * The meadow, placed on the GPU.
 *
 * <p>The old one composed 830,000 instance matrices in JavaScript at load and
 * re-uploaded them whenever anything changed, which is why the density slider
 * stuttered and why editing the terrain would have meant rebuilding the world.
 * This dispatches a compute pass instead: every blade's position, facing, lean,
 * height and colour is derived from its own index, and nothing crosses back to
 * the CPU. Density becomes a number in a uniform buffer.
 *
 * <p><b>Sway happens in the compute pass, not in a vertex shader.</b> That is
 * the unusual choice here and it is deliberate: it keeps the material entirely
 * stock — Babylon's own `PBRMaterial`, with its shadows, its image-based
 * lighting, its clustered lights and its subsurface translucency — instead of
 * injecting a custom vertex path into all of it. The blade turns rigidly about
 * its root rather than bending along its length, which at tabletop distance is
 * a difference nobody has yet been able to point to. If it starts to read as
 * stiff, a `MaterialPluginBase` adds the bend without disturbing anything else.
 */

/** Blades in the buffer. Density scales how many of them are drawn. */
const MAX_BLADES = 600_000;

/** Segments up a blade. Four is enough to taper; the bend is not in geometry. */
const SEGMENTS = 4;

const SOW = `
struct Params {
  a: vec4f,   // extentX, extentY, count, time
  b: vec4f,   // width, height, wearCut, sway
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
  let time = params.a.w;

  // Position from the index alone. No lattice, so no lattice to see: two
  // decorrelated hashes scatter blades over the board, and the count is the
  // only thing density has to change.
  let seed = index * 3u;
  let where2 = vec2f(rand(seed), rand(seed + 1u)) * extent;

  // Clumps. Real grass is not evenly random — it grows in patches with a
  // shared height and a shared cast of colour, and an even scatter reads as
  // AstroTurf however good the blade is.
  let clump = floor(where2 / 12.0);
  let clumpSeed = u32(clump.x + 977.0) * 3557u + u32(clump.y + 977.0) * 6151u;
  let clumpTall = 0.65 + 0.7 * rand(clumpSeed);
  let clumpTone = rand(clumpSeed + 7u);

  let size = vec2f(textureDimensions(groundField, 0));
  let texel = vec2i(clamp(where2 / extent, vec2f(0.0), vec2f(1.0)) * (size - 1.0));
  let ground = textureLoad(groundField, texel, 0);
  let wear = ground.r;
  let drift = ground.b;

  let hSize = vec2f(textureDimensions(heights, 0));
  let hTexel = vec2i(clamp(where2 / extent, vec2f(0.0), vec2f(1.0)) * (hSize - 1.0));
  let ground_z = textureLoad(heights, hTexel, 0).r;

  // Worn ground has no grass on it. The blade is scaled to nothing rather than
  // skipped, because skipping would mean compacting the buffer and an indirect
  // draw — worth doing when the road is more than a sixth of the board.
  var alive = 1.0 - smoothstep(params.b.z - 0.18, params.b.z, wear);
  alive *= step(0.02, alive);

  let tall = params.b.y * clumpTall * (0.7 + 0.6 * rand(seed + 2u)) * alive;
  let wide = params.b.x * (0.8 + 0.4 * rand(seed + 5u));

  // Wind: one slow travelling wave across the board plus a per-blade offset,
  // so a gust crosses the field rather than every blade nodding together.
  let phase = dot(where2, vec2f(0.021, 0.013)) - time * 1.5;
  let gust = sin(phase) * 0.5 + 0.5;
  let lean = params.b.w * (0.35 + 0.65 * gust) * (0.6 + 0.8 * rand(seed + 4u));

  let facing = rand(seed + 3u) * 6.2831853;
  let cf = cos(facing);
  let sf = sin(facing);
  // Lean about the axis across the blade, so it tips the way it faces.
  let cl = cos(lean);
  let sl = sin(lean);

  // Columns of the world matrix: across, up, through, and the root.
  let across = vec3f(cf, 0.0, -sf) * wide;
  let up = vec3f(sf * sl, cl, cf * sl) * tall;
  let through = vec3f(sf * cl, -sl, cf * cl) * wide;

  let at = index * 4u;
  matrices[at + 0u] = vec4f(across, 0.0);
  matrices[at + 1u] = vec4f(up, 0.0);
  matrices[at + 2u] = vec4f(through, 0.0);
  // Board is x-east, y-north, z-up; the stage is y-up. Same swap as the mesh.
  matrices[at + 3u] = vec4f(where2.x, ground_z, where2.y, 1.0);

  // Colour: the clump's cast, the board's slow drift, and a little of the
  // blade's own. Wet ground is darker and greener; dry verge is yellower.
  let green = 0.42 + 0.30 * clumpTone + 0.12 * drift;
  let dry = 0.35 * wear + 0.25 * (1.0 - clumpTone);
  tints[index] = vec4f(
    0.16 + dry * 0.5,
    green,
    0.09 + 0.10 * (1.0 - dry),
    1.0,
  );
}
`;

export interface Meadow {
  readonly mesh: Mesh;
  /** The compute-written instance matrices, so a probe can read them back. */
  readonly matrices: StorageBuffer;
  /** How many blades are drawn, as a fraction of the buffer. */
  setDensity(fraction: number): void;
  /** Re-sows for a new time, which is how the wind moves. */
  step(seconds: number): void;
  /** Whether the last dispatch actually ran. False means the effect is not ready. */
  readonly ran: boolean;
  readonly blades: number;
  dispose(): void;
}

export function sowMeadow(
  field: GroundField, scene: Scene, detailUrl: string,
): Meadow {
  const engine = scene.getEngine() as WebGPUEngine;

  const mesh = new Mesh('meadow', scene);
  bladeGeometry().applyToMesh(mesh);
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.useVertexColors = true;
  mesh.material = bladeMaterial(scene, detailUrl);
  mesh.receiveShadows = true;

  // Storage *and* vertex, which is the whole trick: the compute pass writes it
  // and the vertex stage reads it as instance attributes, with no copy and no
  // trip through JavaScript in between.
  // Storage, vertex *and* write. The write flag is what makes it a
  // `CopyDst` — Babylon aligns a vertex buffer by re-uploading it, and without
  // `CopyDst` that upload is rejected by the device with a validation error
  // rather than an exception, so the buffer silently stays zero and every
  // blade collapses to a degenerate triangle at the origin.
  const flags = Constants.BUFFER_CREATIONFLAG_STORAGE
    | Constants.BUFFER_CREATIONFLAG_VERTEX
    | Constants.BUFFER_CREATIONFLAG_WRITE;
  const matrices = new StorageBuffer(engine, MAX_BLADES * 16 * 4, flags, 'bladeMatrices');
  const tints = new StorageBuffer(engine, MAX_BLADES * 4 * 4, flags, 'bladeTints');

  const matrixBuffer = new Buffer(engine, matrices.getBuffer(), false, 16, false, true);
  for (let column = 0; column < 4; column++) {
    mesh.setVerticesBuffer(matrixBuffer.createVertexBuffer(`world${column}`, column * 4, 4));
  }
  const tintBuffer = new Buffer(engine, tints.getBuffer(), false, 4, false, true);
  mesh.setVerticesBuffer(tintBuffer.createVertexBuffer(VertexBuffer.ColorKind, 0, 4));

  const heightTexture = heightsAsTexture(field, scene);
  const groundTexture = fieldTexture(field, scene);

  const params = new UniformBuffer(engine, undefined, true, 'meadowParams');
  params.addUniform('a', 4);
  params.addUniform('b', 4);

  const sow = new ComputeShader('sow', engine, { computeSource: SOW }, {
    bindingsMapping: {
      params: { group: 0, binding: 0 },
      matrices: { group: 0, binding: 1 },
      tints: { group: 0, binding: 2 },
      groundField: { group: 0, binding: 3 },
      heights: { group: 0, binding: 4 },
    },
  });
  sow.setUniformBuffer('params', params);
  sow.setStorageBuffer('matrices', matrices);
  sow.setStorageBuffer('tints', tints);
  sow.setTexture('groundField', groundTexture, false);
  sow.setTexture('heights', heightTexture, false);

  let count = Math.round(MAX_BLADES * 0.5);
  mesh.forcedInstanceCount = count;

  let ran = false;
  const dispatch = (seconds: number): void => {
    params.updateFloat4('a', field.extentXHalfFeet, field.extentYHalfFeet, count, seconds);
    // Blade width and height in half-feet: a foot and a half of meadow grass,
    // and a blade about an inch across.
    params.updateFloat4('b', 0.17, 3.0, 0.62, 0.42);
    params.update();
    ran = sow.dispatch(Math.ceil(count / 64));
  };
  dispatch(0);

  return {
    mesh,
    matrices,
    blades: MAX_BLADES,
    get ran(): boolean { return ran; },
    setDensity(fraction: number): void {
      count = Math.max(0, Math.min(MAX_BLADES, Math.round(MAX_BLADES * fraction)));
      mesh.forcedInstanceCount = count;
    },
    step(seconds: number): void {
      dispatch(seconds);
    },
    dispose(): void {
      mesh.dispose();
      matrices.dispose();
      tints.dispose();
      params.dispose();
      heightTexture.dispose();
      groundTexture.dispose();
    },
  };
}

/**
 * One blade: a strip that tapers to a point.
 *
 * <p>Built around the origin at the root and one unit tall, so the instance
 * matrix carries all of the size. Two-sided, because a blade seen from behind
 * is still a blade.
 */
function bladeGeometry(): VertexData {
  const rows = SEGMENTS + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < rows; row++) {
    const t = row / SEGMENTS;
    // Width follows a curve rather than a straight taper — a real blade is
    // widest a third of the way up, not at the ground.
    const half = 0.5 * Math.sin(Math.PI * Math.pow(t, 0.62)) * (1 - t * 0.15);
    positions.push(-half, t, 0, half, t, 0);
    uvs.push(0, t, 1, t);
  }
  for (let row = 0; row < SEGMENTS; row++) {
    const a = row * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }

  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  // Facing straight out of the blade. Not computed from the geometry, which is
  // flat and would give a normal that makes every blade read as a shard of
  // glass under a low sun; this is the leaf's own facing.
  data.normals = new Array(rows * 2 * 3).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0));
  return data;
}

function bladeMaterial(scene: Scene, detailUrl: string): PBRMaterial {
  const material = new PBRMaterial('blade', scene);
  material.metallic = 0;
  material.roughness = 0.78;
  material.backFaceCulling = false;
  // A blade seen from behind is still a blade, and its normal has to turn
  // round with it or half the meadow is lit as though the sun were on the
  // other side of the sky.
  material.twoSidedLighting = true;
  material.albedoColor = Color3.White();
  material.specularIntensity = 0.25;

  // <b>Translucency, in the box.</b> This is the Crysis approximation the old
  // renderer spelled out by hand — light arriving through a leaf from the far
  // side — except that here it is a supported feature of the material and it
  // interacts correctly with everything else the material does.
  material.subSurface.isTranslucencyEnabled = true;
  material.subSurface.translucencyIntensity = 0.85;
  material.subSurface.minimumThickness = 0.1;
  material.subSurface.maximumThickness = 0.6;
  material.subSurface.tintColor = new Color3(0.42, 0.72, 0.24);

  const detail = new Texture(detailUrl, scene, false, false);
  detail.wrapU = Texture.CLAMP_ADDRESSMODE;
  detail.wrapV = Texture.CLAMP_ADDRESSMODE;
  material.albedoTexture = detail;
  material.useAlphaFromAlbedoTexture = false;
  return material;
}

/**
 * The height field as something a compute shader can read.
 *
 * <p>Read with `textureLoad` rather than sampled, so it needs no filtering —
 * which matters, because filtering a 32-bit float texture is a WebGPU device
 * feature that is not always there, and a blade a texel out of place is not a
 * blade anybody can see.
 */
function heightsAsTexture(field: GroundField, scene: Scene): RawTexture {
  return new RawTexture(
    field.heights, field.width, field.height,
    Constants.TEXTUREFORMAT_R, scene, false, false,
    Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
  );
}

export { MAX_BLADES };
