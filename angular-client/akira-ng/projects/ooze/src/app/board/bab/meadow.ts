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
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { type Plant, MEADOW, SWARD_FADE_FROM, SWARD_FADE_TO } from './species';
import { fieldTexture } from './splat-bake';

const MAX_PLANTS = 600_000;

const TUFT = 5;

const SLOT_EPSILON = 1e-9;

const CLUMP = 11;

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
  a: vec4f,
  b: vec4f,
  c: vec4f,
  d: vec4f,
  kinds: array<vec4f, 8>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> matrices: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> tints: array<vec4f>;
@group(0) @binding(3) var groundField: texture_2d<f32>;
@group(0) @binding(4) var heights: texture_2d<f32>;
@group(0) @binding(5) var<storage, read_write> tally: array<atomic<u32>>;

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

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let w = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2f(i), hash2f(i + vec2f(1.0, 0.0)), w.x),
    mix(hash2f(i + vec2f(0.0, 1.0)), hash2f(i + vec2f(1.0, 1.0)), w.x), w.y);
}

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

  let slots = max(1u, u32(params.b.x));
  let eastCells = max(1u, u32(params.b.y));
  let northCells = max(1u, u32(params.b.w));
  let span = max(0.01, params.b.z);
  let slot = index % slots;
  let cellIndex = index / slots;
  let cx = cellIndex % eastCells;
  let cy = cellIndex / eastCells;
  let gx = f32(cx);
  let gy = f32(cy);

  let seed = (u32(i32(gx) + 16384) * 2654435761u)
    ^ (u32(i32(gy) + 16384) * 2246822519u)
    ^ ((slot + u32(params.a.w)) * 3266489917u);
  let stagger = f32(u32(abs(gy)) & 1u) * 0.5;
  let inCell = (vec2f(rand(seed), rand(seed + 1u)) - 0.5) * 0.88 + 0.5;
  let where2 = vec2f(gx + stagger, gy) * span + inCell * span;

  if (cy >= northCells || where2.x < 0.0 || where2.y < 0.0
      || where2.x >= extent.x || where2.y >= extent.y) {
    return;
  }

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

  let limit = vec2i(hSize) - vec2i(1);
  let hx0 = textureLoad(heights, clamp(hTexel + vec2i(-1, 0), vec2i(0), limit), 0).r;
  let hx1 = textureLoad(heights, clamp(hTexel + vec2i(1, 0), vec2i(0), limit), 0).r;
  let hy0 = textureLoad(heights, clamp(hTexel + vec2i(0, -1), vec2i(0), limit), 0).r;
  let hy1 = textureLoad(heights, clamp(hTexel + vec2i(0, 1), vec2i(0), limit), 0).r;
  let perTexel = extent / hSize;
  let slope = vec2f((hx1 - hx0) / (2.0 * perTexel.x), (hy1 - hy0) / (2.0 * perTexel.y));
  let groundN = normalize(vec3f(-slope.x, 1.0, -slope.y));

  let green = params.c.y;

  var alive = 1.0 - smoothstep(${SWARD_FADE_FROM.toFixed(2)}, ${SWARD_FADE_TO.toFixed(2)}, wear);
  let damp = params.c.x;
  alive *= clamp(1.0 + damp * (wet - 0.35) * 1.6, 0.15, 1.0);
  alive *= step(0.02, alive);

  let kinds = max(1u, u32(params.d.y));
  var total = 0.0;
  var mine = 0.0;
  for (var k = 0u; k < kinds; k++) {
    let entry = params.kinds[k];
    let weight = entry.x * pow(driftAt(where2, k), entry.z) * (entry.z + 1.0);
    total += weight;
    if (k == u32(params.d.x)) {
      mine = weight;
    }
  }
  let share = max(0.0001, params.d.z);
  let crowd = max(1.0, params.d.w);
  let relative = select(0.0, (mine / total) / share, total > 0.0);
  alive *= step(rand(seed + 9u), params.c.w * min(relative, crowd));
  alive *= params.c.z;
  alive *= 0.72 + 0.28 * green;
  if (alive < 0.02) {
    return;
  }

  let grow = clumpTall * (0.74 + 0.52 * rand(seed + 2u)) * alive;
  let tall = grow;
  let wide = grow;

  let outward = where2 - middle;
  let splay = select(atan2(outward.y, outward.x), rand(seed + 4u) * 6.2831853,
    dot(outward, outward) < 0.02);
  let facing = splay + (rand(seed + 5u) - 0.5) * 1.5;
  let cf = cos(facing);
  let sf = sin(facing);

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

  let at = atomicAdd(&tally[0], 1u) * 4u;
  matrices[at + 0u] = vec4f(across, 0.0);
  matrices[at + 1u] = vec4f(up, 0.0);
  matrices[at + 2u] = vec4f(through, 0.0);
  matrices[at + 3u] = vec4f(where2.x, ground_z, where2.y, 1.0);

  let enclosed = clamp(clumpTall * alive * 0.78, 0.0, 1.0);

  let vigour = driftAt(where2, u32(params.d.x));
  let lift = 0.84 + 0.26 * clumpTone + 0.12 * drift + 0.08 * rand(seed + 7u)
    + 0.10 * (vigour - 0.5) - 0.16 * (1.0 - green);
  let yellow = 0.88 + 0.34 * rand(clumpSeed + 21u) - 0.30 * (vigour - 0.5)
    + 0.46 * (1.0 - green);
  let deep = 0.90 + 0.22 * rand(clumpSeed + 22u) + 0.26 * (vigour - 0.5)
    - 0.30 * (1.0 - green);
  tints[at / 4u] = vec4f(
    lift * yellow, lift * deep, lift * (0.80 + 0.24 * drift), enclosed);
}
`;

export interface Lattice {

  readonly pitch: number;
  readonly eastCells: number;
  readonly northCells: number;
  readonly cells: number;

  readonly fit: number;
}

export interface Sowing {
  readonly plant: Plant;

  readonly slots: number;
  readonly cap: number;
  readonly keep: number;
}

export function swardLattice(
  plants: readonly Plant[], extentXHalfFeet: number, extentYHalfFeet: number,
): { lattice: Lattice; sowings: readonly Sowing[] } {
  const area = extentXHalfFeet * extentYHalfFeet;
  const asked = plants.reduce((sum, plant) => sum + plant.perArea * plant.crowd, 0) * area;
  const fit = Math.min(1, MAX_PLANTS / Math.max(1, asked));
  const densest = Math.max(...plants.map(plant => plant.perArea), 1e-6) * fit;
  const pitch = Math.sqrt(TUFT / densest);
  const eastCells = Math.max(1, Math.ceil(extentXHalfFeet / pitch));
  const northCells = Math.max(1, Math.ceil(extentYHalfFeet / pitch));
  const cells = eastCells * northCells;
  const cellArea = pitch * pitch;
  return {
    lattice: { pitch, eastCells, northCells, cells, fit },
    sowings: plants.map(plant => {
      const wanted = plant.perArea * fit * cellArea;
      const asked = wanted * plant.crowd;
      const slots = Math.max(1, Math.ceil(asked - SLOT_EPSILON));
      return { plant, slots, cap: slots * cells, keep: Math.min(1, wanted / slots) };
    }),
  };
}

export interface Sown {
  readonly plant: Plant;

  readonly cap: number;
  readonly keep: number;
  readonly mesh: Mesh;
  readonly wind: BladeWind;

  readonly matrices: StorageBuffer;
  readonly tints: StorageBuffer;

  readonly tally: StorageBuffer;

  count: number;
}

export interface Meadow {
  readonly sown: readonly Sown[];

  readonly lattice: Lattice;

  readonly compute: readonly ComputeShader[];

  setDensity(fraction: number): void;

  setSeason(green: number, bloom: number): void;

  step(seconds: number): void;

  readonly ran: boolean;
  readonly plants: number;
  dispose(): void;
}

export type PlantShape = (plant: Plant, sheet: FoliageSheet) => VertexData;

export function sowMeadow(
  field: GroundField, scene: Scene, sheet: FoliageSheet,
  plants: readonly Plant[] = MEADOW,
  shape: PlantShape = cardGeometry,
): Meadow {
  const engine = scene.getEngine() as WebGPUEngine;
  const heightTexture = heightsAsTexture(field, scene);
  const groundTexture = fieldTexture(field, scene);
  const total = plants.reduce((sum, plant) => sum + plant.perArea, 0);

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

    readonly tally: StorageBuffer;

    readonly publish: ComputeShader;

    wired: boolean;

    announce: number;
    readonly slots: number;
    readonly offset: number;

    readonly kind: number;
  }

  const { lattice, sowings } = swardLattice(
    plants, field.extentXHalfFeet, field.extentYHalfFeet,
  );
  const { pitch, eastCells, northCells, cells } = lattice;

  const beds: Bed[] = [];
  let seedOffset = 0;

  const kinds = new Float32Array(32);
  plants.forEach((plant, at) => {
    kinds[at * 4 + 0] = plant.perArea / total;
    kinds[at * 4 + 1] = plant.patch;
    kinds[at * 4 + 2] = plant.clumping;
  });

  for (const { plant, slots: slotsFull, cap, keep } of sowings) {

    const mesh = new Mesh(`meadow-${plant.id}`, scene);

    shape(plant, sheet).applyToMesh(mesh);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.useVertexColors = true;

    mesh.receiveShadows = false;

    const material = new PBRMaterial(`plant-${plant.id}`, scene);
    material.metallic = 0;

    material.roughness = 0.55;
    material.backFaceCulling = false;

    material.twoSidedLighting = false;

    material.albedoTexture = sheet.texture;
    material.albedoColor = new Color3(1, 1, 1);

    material.useAlphaFromAlbedoTexture = true;
    material.transparencyMode = PBRMaterial.MATERIAL_ALPHATEST;

    material.alphaCutOff = 0.28;

    material.twoSidedLighting = false;

    material.subSurface.isTranslucencyEnabled = true;

    material.subSurface.minimumThickness = 0;
    material.subSurface.maximumThickness = 0.1;
    material.subSurface.translucencyIntensity = 0.55;
    material.subSurface.tintColor = new Color3(
      plant.tip[0] * 1.5 + 0.1, plant.tip[1] * 1.35 + 0.1, plant.tip[2] * 0.9,
    );

    (material as unknown as { _getReflectionTexture(): null })
      ._getReflectionTexture = () => null;

    material.fogEnabled = false;

    const wind = new BladeWind(material);
    wind.tall = plant.tall;

    wind.strength = 0.62 * plant.stiff;

    wind.tip = [1, 1, 1];
    wind.floor = 0.34;
    wind.ground = plant.lit;

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
    params.addUniform('kinds', 4, 8);

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
      sown: { plant, mesh, wind, matrices, tints, tally, count: cap, cap, keep },
      matrices, tints, params, compute, slots: slotsFull,
      offset: seedOffset, kind: beds.length, tally, publish,
      wired: false, announce: 0,
    });
    seedOffset += cap;
  }

  let ran = false;
  let density = 1;
  let green = 1;
  let bloom = 1;

  const sow = (): void => {
    let all = true;
    for (const bed of beds) {

      const count = bed.sown.cap;
      bed.sown.count = count;

      bed.sown.mesh.forcedInstanceCount = bed.sown.cap;

      bed.tally.update(new Uint32Array([0]));
      bed.announce = 3;
      bed.params.updateFloat4(
        'a', field.extentXHalfFeet, field.extentYHalfFeet, count, bed.offset,
      );
      bed.params.updateFloat4('b', bed.slots, eastCells, pitch, northCells);
      bed.params.updateFloat4(
        'c', bed.sown.plant.damp, green,
        bed.sown.plant.blooms ? bloom : 1, bed.sown.keep * density,
      );
      bed.params.updateFloat4(
        'd', bed.kind, plants.length, bed.sown.plant.perArea / total,
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
    lattice,
    compute: beds.flatMap(bed => [bed.compute, bed.publish]),
    plants: MAX_PLANTS,
    get ran(): boolean { return ran; },
    setSeason(howGreen: number, howBloomed: number): void {
      green = Math.max(0, Math.min(1, howGreen));
      bloom = Math.max(0, Math.min(1, howBloomed));
      sow();
    },
    setDensity(fraction: number): void {
      density = Math.max(0, Math.min(1, fraction));

      sow();
    },
    step(seconds: number): void {
      for (const bed of beds) {
        bed.sown.wind.time = seconds;

        if (!bed.wired) {

          const context = drawContext(
            bed.sown.mesh, scene.activeCamera?.renderPassId);
          if (context?.indirectDrawBuffer) {

            context.enableIndirectDraw = true;
          }
          const args = context?.indirectDrawBuffer;
          if (args) {
            bed.publish.setStorageBuffer('draws', new WebGPUDataBuffer(args, 20));
            bed.wired = true;
            bed.announce = 3;
          }
        }

        if (bed.wired && bed.announce > 0) {
          bed.publish.dispatch(1);
          bed.announce--;
        }
      }
      if (!ran) {

        sow();
      }
    },
    dispose(): void {
      for (const bed of beds) {

        bed.sown.mesh.material?.dispose();
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

interface DrawContext {
  indirectDrawBuffer?: GPUBuffer;
  enableIndirectDraw: boolean;
}

function drawContext(mesh: Mesh, pass?: number): DrawContext | undefined {
  const sub = mesh.subMeshes?.[0] as unknown as {
    _getDrawWrapper?: (passId?: number) => { drawContext?: DrawContext } | undefined;
  } | undefined;
  return sub?._getDrawWrapper?.(pass)?.drawContext;
}

function heightsAsTexture(field: GroundField, scene: Scene): RawTexture {
  return new RawTexture(
    field.heights, field.width, field.height,
    Constants.TEXTUREFORMAT_R, scene, false, false,
    Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
  );
}

export { MAX_PLANTS };
