import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { type GroundField, groundAt, heightAt, noise, slopeAt } from '../ground-field';
import { assetUrl } from './assets';
import type { Cut, FoliageSheet } from './foliage-cards';

export interface Standing {
  readonly meshes: readonly Mesh[];
  dispose(): void;
}

const TREES = 7;
const SCRUB = 54;

const TREE_TALL = 64;

interface Build {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

function empty(): Build {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

function dice(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function margin(field: GroundField, x: number, y: number): number {
  const near = Math.min(
    x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
  );

  if (near < 52) {
    return 0;
  }
  return 1 - Math.min(1, Math.max(0, near - 58) / 64);
}

function groundUnder(
  field: GroundField, x: number, y: number, reach: number,
): number {
  let low = heightAt(field, x, y);
  const span = Math.max(1, Math.ceil(reach));
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      if (dx * dx + dy * dy > span * span) {
        continue;
      }
      low = Math.min(low, heightAt(
        field, Math.floor(x) + dx, Math.floor(y) + dy,
      ));
    }
  }
  return low;
}

export async function loadScans(
  name: string, scene: Scene, wanted: readonly number[],
): Promise<Map<number, Mesh>> {
  const box = await LoadAssetContainerAsync(
    assetUrl(`assets/board/models/${name}/${name}.gltf`), scene,
  );
  const drawn = box.meshes.filter(mesh => mesh.getTotalVertices() > 0) as Mesh[];

  const byNode = new Map<string, Mesh[]>();
  for (const mesh of drawn) {
    const node = mesh.parent && mesh.parent.name !== '__root__' ? mesh.parent : mesh;
    const found = byNode.get(node.name);
    if (found) {
      found.push(mesh);
    } else {
      byNode.set(node.name, [mesh]);
    }
  }

  const plants = [...byNode.keys()].sort().map(
    key => byNode.get(key)!.sort((a, b) => a.name.localeCompare(b.name)),
  );
  const chosen = [...new Set(wanted)].map(want => ({
    want, parts: plants[Math.min(want, plants.length - 1)] ?? [],
  }));
  const keep = new Set<Mesh>();
  chosen.forEach(({ parts }) => parts.forEach(mesh => keep.add(mesh)));
  drawn.filter(mesh => !keep.has(mesh)).forEach(mesh => mesh.dispose());
  box.removeAllFromScene();

  const out = new Map<number, Mesh>();
  for (const { want, parts } of chosen) {
    if (!parts.length) {
      continue;
    }

    for (const mesh of parts) {
      mesh.setParent(null);
      mesh.bakeCurrentTransformIntoVertices();
    }

    parts[0].refreshBoundingInfo();
    const trunk = parts[0].getBoundingInfo().boundingBox;
    const stands = new Vector3(
      (trunk.minimum.x + trunk.maximum.x) / 2,
      trunk.minimum.y,
      (trunk.minimum.z + trunk.maximum.z) / 2,
    );
    const one = parts.length === 1
      ? parts[0]
      : Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (!one) {
      continue;
    }

    if (!scene.meshes.includes(one)) {
      scene.addMesh(one);
    }

    one.bakeTransformIntoVertices(Matrix.Translation(
      -stands.x, -stands.y, -stands.z,
    ));
    one.refreshBoundingInfo();
    one.position.setAll(0);
    one.rotationQuaternion = null;
    one.rotation.setAll(0);
    one.scaling.setAll(1);
    one.computeWorldMatrix(true);
    out.set(want, one);
  }
  return out;
}

export interface ScanKind {
  readonly name: string;
  readonly count: number;

  readonly tall: number;
  readonly inside: number;
  readonly wearMax: number;

  readonly edge: number;

  readonly plant?: number;

  readonly label: string;
}

export const STANDING: readonly ScanKind[] = [

    { name: 'island_tree_02', count: 3, tall: 38, inside: 46, wearMax: 0.58, edge: 0.8, label: 'Island tree' },
    { name: 'searsia_lucida', count: 4, tall: 16, inside: 20, wearMax: 0.6, edge: 0.7, plant: 0, label: 'Searsia, tall bush' },
    { name: 'searsia_lucida', count: 5, tall: 11, inside: 14, wearMax: 0.66, edge: 0.5, plant: 2, label: 'Searsia, bush' },
    { name: 'searsia_lucida', count: 6, tall: 7, inside: 12, wearMax: 0.7, edge: 0.45, plant: 4, label: 'Searsia, low scrub' },
  ];

export async function plantScans(
  field: GroundField, scene: Scene,
): Promise<Mesh[]> {
  const kinds = STANDING;

  const wanted = new Map<string, number[]>();
  for (const kind of kinds) {
    const list = wanted.get(kind.name) ?? [];
    list.push(kind.plant ?? 0);
    wanted.set(kind.name, list);
  }
  const loaded = new Map<string, Map<number, Mesh>>();
  for (const [name, plants] of wanted) {
    loaded.set(name, await loadScans(name, scene, plants));
  }

  const out: Mesh[] = [];

  const standing: { x: number; y: number; reach: number }[] = [];
  for (let kind = 0; kind < kinds.length; kind++) {
    const want = kinds[kind];
    const scan = loaded.get(want.name)?.get(want.plant ?? 0);
    if (!scan) {
      continue;
    }
    scan.name = `scan-${want.name}-${want.plant ?? 0}`;

    maskCutouts(scan, scene, 0.35);

    scan.refreshBoundingInfo();
    const box = scan.getBoundingInfo().boundingBox;
    const own = Math.max(0.001, box.maximum.y - box.minimum.y);

    const matrices: Matrix[] = [];

    const tries = want.count * 60;
    for (let at = 0; at < tries && matrices.length < want.count; at++) {
      const insist = at > tries * 0.66;
      const x = dice(at, 37 + kind * 3, 61 + kind * 7) * field.extentXHalfFeet;
      const y = dice(at, 41 + kind * 5, 67 + kind * 11) * field.extentYHalfFeet;
      const inside = Math.min(
        x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
      );
      const { wear } = groundAt(field, x, y);
      if (inside < want.inside || wear > want.wearMax
        || slopeAt(field, x, y) > 0.44) {
        continue;
      }
      const size = (want.tall / own) * (0.78 + 0.44 * dice(at, 5, 7 + kind));

      const reach = want.tall * (size / (want.tall / own)) * 0.34;
      if (standing.some(other => {
        const dx = other.x - x;
        const dy = other.y - y;
        return dx * dx + dy * dy < (other.reach + reach) * (other.reach + reach);
      })) {
        continue;
      }
      const band = 1 - Math.min(1, Math.max(0, inside - want.inside - 6) / 70);
      const verge = wear > 0.18 && wear < 0.5 ? 1 : 0;
      const drift = noise(
        x * 0.014 + 31.7 + kind * 9, y * 0.014 - 12.3 - kind * 4,
      );
      if (!insist && band * want.edge + verge * 0.45 + drift * 0.55 < 0.66
        && dice(at, 1, 91 + kind) > 0.1) {
        continue;
      }
      standing.push({ x, y, reach });
      matrices.push(Matrix.Compose(
        new Vector3(size, size * (0.9 + 0.22 * dice(at, 9, 13)), size),
        Quaternion.FromEulerAngles(0, dice(at, 13, 89) * 6.2831853, 0),

        new Vector3(
          x, groundUnder(field, x, y, reach * 0.4) - want.tall * 0.02, y,
        ),
      ));
    }
    if (!matrices.length) {
      scan.dispose();
      continue;
    }
    const packed = new Float32Array(matrices.length * 16);
    matrices.forEach((matrix, at) => matrix.copyToArray(packed, at * 16));
    scan.thinInstanceSetBuffer('matrix', packed, 16);
    scan.alwaysSelectAsActiveMesh = true;
    scan.receiveShadows = true;
    out.push(scan);
  }
  return out;
}

export interface StoneKind {
  readonly name: string;

  readonly rock?: number;

  readonly tall: number;

  readonly open: boolean;

  readonly label: string;
}

export interface FloraKind {
  readonly name: string;
  readonly part: number;
  readonly label: string;

  readonly count: number;

  readonly tall: number;

  readonly drift: number;

  readonly wearMax: number;
}

export const GROUND_FLORA: readonly FloraKind[] = [

  {
    name: 'dandelion_01', part: 2, label: 'Dandelion, in flower',
    count: 240, tall: 3.2, drift: 0.72, wearMax: 0.34,
  },
  {
    name: 'dandelion_01', part: 4, label: 'Dandelion, small',
    count: 420, tall: 2.1, drift: 0.6, wearMax: 0.46,
  },

  {
    name: 'celandine_01', part: 0, label: 'Celandine, spreading',
    count: 620, tall: 2.4, drift: 0.55, wearMax: 0.38,
  },
  {
    name: 'celandine_01', part: 1, label: 'Celandine',
    count: 760, tall: 2.0, drift: 0.5, wearMax: 0.42,
  },
  {
    name: 'celandine_01', part: 4, label: 'Celandine, small',
    count: 980, tall: 1.6, drift: 0.42, wearMax: 0.5,
  },
];

function maskCutouts(mesh: Mesh, scene: Scene, cutoff: number): void {
  for (const material of materialsOf(mesh)) {
    const atlas = ((material.albedoTexture as Texture | null)?.url ?? '')
      .replace(/^data:/, '');

    const mode = material.transparencyMode;
    const cutout = mode === PBRMaterial.MATERIAL_ALPHATEST
      || mode === PBRMaterial.MATERIAL_ALPHABLEND
      || mode === PBRMaterial.MATERIAL_ALPHATESTANDBLEND;
    if (!cutout || !atlas.includes('_diff_')) {
      continue;
    }
    const mask = new Texture(
      atlas.replace('_diff_', '_alpha_'), scene, false, false,
    );
    mask.getAlphaFromRGB = true;
    material.opacityTexture = mask;

    material.transparencyMode = PBRMaterial.MATERIAL_ALPHATEST;
    material.alphaCutOff = cutoff;
    material.backFaceCulling = false;
    material.twoSidedLighting = true;
  }
}

function materialsOf(mesh: Mesh): PBRMaterial[] {
  const worn = mesh.material as unknown as {
    subMaterials?: (PBRMaterial | null)[];
  } | null;
  const list: unknown[] = worn?.subMaterials ?? [mesh.material];
  return list.filter((one): one is PBRMaterial =>
    !!one && typeof one === 'object' && 'subSurface' in one);
}

export async function scatterFlora(
  field: GroundField, scene: Scene,
): Promise<Mesh[]> {
  const wanted = new Map<string, number[]>();
  for (const kind of GROUND_FLORA) {
    const list = wanted.get(kind.name) ?? [];
    list.push(kind.part);
    wanted.set(kind.name, list);
  }
  const loaded = new Map<string, Map<number, Mesh>>();
  for (const [name, parts] of wanted) {
    loaded.set(name, await loadScans(name, scene, parts));
  }

  const out: Mesh[] = [];
  for (let kind = 0; kind < GROUND_FLORA.length; kind++) {
    const want = GROUND_FLORA[kind];
    const plant = loaded.get(want.name)?.get(want.part);
    if (!plant) {
      continue;
    }
    plant.name = `flora-${want.name}-${want.part}`;

    maskCutouts(plant, scene, 0.3);
    plant.refreshBoundingInfo();
    const box = plant.getBoundingInfo().boundingBox;
    const own = Math.max(0.001, box.maximum.y - box.minimum.y);

    const cells = want.count * 3;
    const across = Math.max(1, Math.round(Math.sqrt(
      (cells * field.extentXHalfFeet) / field.extentYHalfFeet)));
    const along = Math.max(1, Math.ceil(cells / across));
    const matrices: Matrix[] = [];
    for (let at = 0; at < across * along && matrices.length < want.count; at++) {
      const cx = at % across;
      const cy = Math.floor(at / across);
      const x = ((cx + 0.5 + (dice(at, 3, 17 + kind) - 0.5) * 0.9) / across)
      const y = ((cy + 0.5 + (dice(at, 5, 23 + kind) - 0.5) * 0.9) / along)
      const inside = Math.min(
        x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
      );
      if (inside < 4) {
        continue;
      }
      const { wear } = groundAt(field, x, y);
      if (wear > want.wearMax || slopeAt(field, x, y) > 0.5) {
        continue;
      }
      const patch =
        noise(x * 0.028 + 11.3 + kind * 17, y * 0.028 - 7.9 - kind * 13) * 0.62
        + noise(x * 0.091 + 53.7 + kind * 29, y * 0.091 - 31.1 - kind * 19) * 0.26
        + noise(x * 0.24 + 7.1 + kind * 41, y * 0.24 - 13.3 - kind * 37) * 0.12;
      if (patch * (1 + want.drift) + dice(at, 7, 41 + kind) * (1 - want.drift)
        < want.drift) {
        continue;
      }
      const size = (want.tall / own) * (0.8 + 0.4 * dice(at, 11, 53 + kind));
      const lean = 0.26 * (dice(at, 17, 101 + kind) - 0.5);
      const roll = 0.26 * (dice(at, 19, 131 + kind) - 0.5);
      matrices.push(Matrix.Compose(
        new Vector3(size, size, size),
        Quaternion.FromEulerAngles(
          lean, dice(at, 13, 89 + kind) * 6.2831853, roll,
        ),
        new Vector3(
          x, groundUnder(field, x, y, 1) - want.tall * 0.22, y,
        ),
      ));
    }
    if (!matrices.length) {
      plant.dispose();
      continue;
    }
    const packed = new Float32Array(matrices.length * 16);
    matrices.forEach((matrix, at) => matrix.copyToArray(packed, at * 16));
    plant.thinInstanceSetBuffer('matrix', packed, 16);
    plant.alwaysSelectAsActiveMesh = true;

    plant.receiveShadows = false;
    out.push(plant);
  }
  return out;
}

export const FIELDSTONE: readonly StoneKind[] = [
    { name: 'boulder_01', tall: 9, open: true, label: 'Lichen boulder' },
    { name: 'rock_moss_set_01', rock: 3, tall: 8, open: true, label: 'Mossy rock, tall' },
    { name: 'namaqualand_boulder_04', tall: 7, open: false, label: 'Karoo boulder' },

    { name: 'rock_moss_set_01', rock: 0, tall: 7, open: false, label: 'Mossy slab' },
    { name: 'rock_moss_set_01', rock: 4, tall: 7, open: false, label: 'Mossy rock, broad' },
    { name: 'rock_moss_set_01', rock: 2, tall: 6, open: false, label: 'Mossy rock, small' },
    { name: 'rock_moss_set_01', rock: 5, tall: 6, open: false, label: 'Mossy rock, flat' },
];

export async function scatterStone(
  field: GroundField, scene: Scene,
): Promise<Mesh[]> {
  const kinds = FIELDSTONE;

  const wanted = new Map<string, number[]>();
  for (const kind of kinds) {
    const list = wanted.get(kind.name) ?? [];
    list.push(kind.rock ?? 0);
    wanted.set(kind.name, list);
  }
  const loaded = new Map<string, Map<number, Mesh>>();
  for (const [name, rocks] of wanted) {
    loaded.set(name, await loadScans(name, scene, rocks));
  }

  const out: Mesh[] = [];
  const placed: { x: number; y: number; reach: number }[] = [];
  for (let kind = 0; kind < kinds.length; kind++) {
    const want = kinds[kind];
    const rock = loaded.get(want.name)?.get(want.rock ?? 0);
    if (!rock) {
      continue;
    }
    rock.name = `stone-${want.name}-${want.rock ?? 0}`;
    rock.refreshBoundingInfo();
    const box = rock.getBoundingInfo().boundingBox;
    const own = Math.max(0.001, box.maximum.y - box.minimum.y);
    const aspect = Math.max(
      box.maximum.x - box.minimum.x, box.maximum.z - box.minimum.z,
    ) / own;

    const tries = 300;
    let sat: Matrix | null = null;
    for (let at = 0; at < tries && !sat; at++) {
      const insist = at > tries * 0.75;
      const x = dice(at, 29 + kind * 7, 61 + kind * 13) * field.extentXHalfFeet;
      const y = dice(at, 31 + kind * 5, 67 + kind * 11) * field.extentYHalfFeet;
      const inside = Math.min(
        x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
      );
      if (inside < 14) {
        continue;
      }
      const { wear } = groundAt(field, x, y);

      if (wear > 0.5) {
        continue;
      }
      const size = (want.tall / own) * (0.86 + 0.28 * dice(at, 5, 73 + kind));
      const reach = want.tall * aspect * 0.5;
      if (placed.some(other => {
        const dx = other.x - x;
        const dy = other.y - y;
        const apart = other.reach + reach + 26;
        return dx * dx + dy * dy < apart * apart;
      })) {
        continue;
      }
      if (!insist) {
        const fits = want.open
          ? Math.min(1, slopeAt(field, x, y) / 0.26) * 0.7
            + (wear < 0.12 ? 0.3 : 0)
          : (wear > 0.16 && wear < 0.46 ? 0.8 : 0);
        if (fits + noise(x * 0.02 + 5.1 + kind, y * 0.02 - 8.4) * 0.4 < 0.55) {
          continue;
        }
      }
      placed.push({ x, y, reach });
      sat = Matrix.Compose(
        new Vector3(size, size * (0.78 + 0.34 * dice(at, 7, 79 + kind)), size),
        Quaternion.FromEulerAngles(
          (dice(at, 11, 83) - 0.5) * 0.4,
          dice(at, 13, 89 + kind) * 6.2831853,
          (dice(at, 17, 97) - 0.5) * 0.4,
        ),

        new Vector3(
          x, groundUnder(field, x, y, reach * 0.5) - want.tall * 0.1, y,
        ),
      );
    }
    if (!sat) {
      rock.dispose();
      continue;
    }
    const packed = new Float32Array(16);
    sat.copyToArray(packed, 0);
    rock.thinInstanceSetBuffer('matrix', packed, 16);
    rock.receiveShadows = true;
    rock.alwaysSelectAsActiveMesh = true;
    out.push(rock);
  }
  return out;
}

export function raiseStanding(
  field: GroundField, sheet: FoliageSheet, scene: Scene,
): Standing {
  const canopy = sheet.groups['canopy'] ?? [];
  if (!canopy.length) {
    return { meshes: [], dispose: () => undefined };
  }

  const leaves = empty();
  const bark = empty();

  let planted = 0;
  for (let at = 0; at < TREES * 22 && planted < TREES; at++) {
    const x = dice(at, 3, 11) * field.extentXHalfFeet;
    const y = dice(at, 7, 23) * field.extentYHalfFeet;
    const { wear, wet } = groundAt(field, x, y);

    const inside = Math.min(
      x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
    );
    if (inside < 52 || wear > 0.58 || slopeAt(field, x, y) > 0.42) {
      continue;
    }

    const edge = margin(field, x, y);
    const verge = wear > 0.18 && wear < 0.5 ? 1 : 0;
    const drift = noise(x * 0.014 + 31.7, y * 0.014 - 12.3);
    const wants = edge * 0.75 + verge * 0.5 + drift * 0.5;
    if (wants < 0.62 && dice(at, 1, 91) > 0.12) {
      continue;
    }
    planted++;
    const tall = TREE_TALL * (0.74 + 0.52 * dice(at, 5, 7));
    const lean = (dice(at, 9, 13) - 0.5) * 0.16;
    addTree(leaves, bark, canopy, x, y, heightAt(field, x, y), tall, lean, at, wet);
  }

  for (let at = 0; at < SCRUB * 4; at++) {
    const x = dice(at, 17, 41) * field.extentXHalfFeet;
    const y = dice(at, 19, 53) * field.extentYHalfFeet;
    const { wear } = groundAt(field, x, y);
    const inside = Math.min(
      x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
    );
    if (inside < 10 || wear > 0.62) {
      continue;
    }
    const edge = margin(field, x, y);
    const verge = wear > 0.2 && wear < 0.55 ? 1 : 0;
    const drift = noise(x * 0.03 - 8.1, y * 0.03 + 44.2);
    if (edge * 0.7 + verge * 0.6 + drift * 0.7 < 0.78) {
      continue;
    }
    const wide = 3.4 + 4.2 * dice(at, 23, 3);
    addScrub(leaves, canopy, x, y, heightAt(field, x, y), wide, at);
  }

  const sward = new PBRMaterial('standing-leaf', scene);
  sward.metallic = 0;
  sward.roughness = 0.62;
  sward.backFaceCulling = false;
  sward.twoSidedLighting = false;
  sward.albedoTexture = sheet.texture;
  sward.albedoColor = new Color3(1, 1, 1);
  sward.useAlphaFromAlbedoTexture = true;
  sward.transparencyMode = PBRMaterial.MATERIAL_ALPHATEST;
  sward.alphaCutOff = 0.34;

  (sward as unknown as { _getReflectionTexture(): null })
    ._getReflectionTexture = () => null;
  sward.subSurface.isTranslucencyEnabled = false;

  const trunk = new PBRMaterial('standing-bark', scene);
  trunk.metallic = 0;
  trunk.roughness = 1;
  const barkColor = new Texture(
    assetUrl('assets/board/polyhaven/bark_brown_02_diff_1k.jpg'), scene, false, false,
  );
  const barkRelief = new Texture(
    assetUrl('assets/board/polyhaven/bark_brown_02_nor_gl_1k.jpg'), scene, false, false,
  );
  const barkSurface = new Texture(
    assetUrl('assets/board/polyhaven/bark_brown_02_arm_1k.jpg'), scene, false, false,
  );
  trunk.albedoTexture = barkColor;
  trunk.bumpTexture = barkRelief;
  trunk.invertNormalMapY = false;
  trunk.metallicTexture = barkSurface;
  trunk.useAmbientOcclusionFromMetallicTextureRed = true;
  trunk.useRoughnessFromMetallicTextureGreen = true;
  trunk.backFaceCulling = false;

  const meshes: Mesh[] = [];
  const put = (build: Build, name: string, material: PBRMaterial): void => {
    if (!build.indices.length) {
      return;
    }
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = build.positions;
    data.normals = build.normals;
    data.uvs = build.uvs;
    data.indices = build.indices;
    data.applyToMesh(mesh);
    mesh.material = material;

    mesh.receiveShadows = true;
    meshes.push(mesh);
  };
  put(leaves, 'standing-leaves', sward);
  put(bark, 'standing-bark', trunk);

  return {
    meshes,
    dispose(): void {
      meshes.forEach(mesh => mesh.dispose());
      sward.dispose();
      trunk.dispose();
      barkColor.dispose();
      barkRelief.dispose();
      barkSurface.dispose();
    },
  };
}

function addTree(
  leaves: Build, bark: Build, canopy: readonly Cut[],
  x: number, y: number, ground: number, tall: number, lean: number,
  seed: number, wet: number,
): void {
  const forkAt = tall * 0.42;
  const thick = tall * 0.030;
  const top: Vec = [x + lean * forkAt, ground + forkAt, y];
  addLimb(bark, [x, ground, y], top, thick * 1.5, thick * 0.74);

  const limbs = 4 + Math.floor(dice(seed, 3, 2) * 3);
  const lobes: { at: Vec; size: number }[] = [];
  for (let n = 0; n < limbs; n++) {
    const around = n * 2.39996 + dice(seed, n, 8) * 0.7;
    const out = 0.42 + 0.36 * dice(seed, n, 14);
    const reach = tall * (0.30 + 0.16 * dice(seed, n, 22));
    const end: Vec = [
      top[0] + Math.cos(around) * out * reach,
      top[1] + reach * (0.82 - out * 0.34),
      top[2] + Math.sin(around) * out * reach,
    ];
    addLimb(bark, top, end, thick * 0.7, thick * 0.28);
    lobes.push({ at: end, size: tall * (0.15 + 0.07 * dice(seed, n, 26)) });
  }

  lobes.push({
    at: [top[0], top[1] + tall * 0.30, top[2]],
    size: tall * 0.17,
  });

  for (let n = 0; n < lobes.length; n++) {
    const lobe = lobes[n];
    const cards = 10 + Math.floor(dice(seed, n, 31) * 6);
    for (let c = 0; c < cards; c++) {
      const around = c * 2.39996 + dice(seed, n * 7 + c, 4) * 0.8;
      const deep = Math.cbrt((c + 0.5) / cards);
      const up = dice(seed, n * 11 + c, 37) * 2 - 1;
      const ring = Math.sqrt(Math.max(0, 1 - up * up));
      addCanopyCard(
        leaves, canopy[(seed * 5 + n * 3 + c) % canopy.length],
        lobe.at[0] + Math.cos(around) * ring * deep * lobe.size,
        lobe.at[2] + Math.sin(around) * ring * deep * lobe.size,
        lobe.at[1] + up * deep * lobe.size * 0.8,
        lobe.size * (0.78 + 0.44 * dice(seed, n * 13 + c, 17)),
        around, Math.max(0.05, up * 0.5 + 0.5),
        dice(seed, n * 17 + c, 41), wet,
      );
    }
  }
}

function addLimb(
  build: Build, from: Vec, to: Vec, thickFrom: number, thickTo: number,
): void {
  const up = unit([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);

  const aside = Math.abs(up[1]) > 0.9 ? [1, 0, 0] as Vec : [0, 1, 0] as Vec;
  const across = unit(cross(up, aside));
  const through = cross(up, across);

  const sides = 5;
  const first = build.positions.length / 3;
  for (const [end, size] of [[from, thickFrom], [to, thickTo]] as const) {
    for (let side = 0; side <= sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const nx = across[0] * ca + through[0] * sa;
      const ny = across[1] * ca + through[1] * sa;
      const nz = across[2] * ca + through[2] * sa;
      build.positions.push(
        end[0] + nx * size, end[1] + ny * size, end[2] + nz * size,
      );
      build.normals.push(nx, ny, nz);
      build.uvs.push(side / sides, end === from ? 0 : 1.6);
    }
  }
  for (let side = 0; side < sides; side++) {
    const a = first + side;
    const b = first + sides + 1 + side;
    build.indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
}

function addScrub(
  leaves: Build, canopy: readonly Cut[],
  x: number, y: number, ground: number, wide: number, seed: number,
): void {
  const cards = 3 + Math.floor(dice(seed, 4, 9) * 3);
  for (let n = 0; n < cards; n++) {
    const around = n * 2.39996 + dice(seed, n, 6) * 0.9;
    const away = wide * 0.32 * Math.sqrt(dice(seed, n, 12));
    addCanopyCard(
      leaves, canopy[(seed + n) % canopy.length],
      x + Math.cos(around) * away, y + Math.sin(around) * away,
      ground + wide * (0.16 + 0.2 * dice(seed, n, 18)),
      wide * (0.5 + 0.3 * dice(seed, n, 21)),
      around, 0.72, dice(seed, n, 33), 0,
    );
  }
}

function addCanopyCard(
  build: Build, cut: Cut,
  x: number, y: number, z: number, size: number,
  around: number, up: number, roll: number, wet: number,
): void {
  const wide = size * cut.aspect;
  const ca = Math.cos(around);
  const sa = Math.sin(around);

  const flat = Math.sqrt(Math.max(0.0001, 1 - up * up));
  const face: Vec = [ca * flat, up, sa * flat];
  const across: Vec = [-sa, 0, ca];
  const along: Vec = cross(face, across);

  const cr = Math.cos(roll * 6.2831853);
  const sr = Math.sin(roll * 6.2831853);
  const u: Vec = add(scale(across, cr), scale(along, sr));
  const v: Vec = add(scale(across, -sr), scale(along, cr));

  const rows = 2;
  const first = build.positions.length / 3;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const edge = spanOf(cut, t);

    const height = (t - 0.5) * size;
    for (const side of [0, 1] as const) {
      const off = (edge[side] - 0.5) * wide;
      build.positions.push(
        x + u[0] * off + v[0] * height,
        z + u[1] * off + v[1] * height,
        y + u[2] * off + v[2] * height,
      );

      const lifted = add(face, scale(u, (side === 0 ? -0.5 : 0.5)));
      build.normals.push(...unit(lifted));
      build.uvs.push(
        cut.u0 + (cut.u1 - cut.u0) * edge[side],
        cut.v1 + (cut.v0 - cut.v1) * t,
      );
    }
  }
  for (let row = 0; row < rows; row++) {
    const a = first + row * 2;
    build.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  void wet;
}

type Vec = readonly [number, number, number];

function spanOf(cut: Cut, t: number): readonly [number, number] {
  const spans = cut.spans;
  if (!spans?.length) {
    return [0, 1];
  }
  const at = Math.min(spans.length - 1, Math.max(0, t * (spans.length - 1)));
  const low = Math.floor(at);
  const high = Math.min(spans.length - 1, low + 1);
  const mix = at - low;
  return [
    spans[low][0] + (spans[high][0] - spans[low][0]) * mix,
    spans[low][1] + (spans[high][1] - spans[low][1]) * mix,
  ];
}

function cross(a: Vec, b: Vec): Vec {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function add(a: Vec, b: Vec): Vec {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec, by: number): Vec {
  return [a[0] * by, a[1] * by, a[2] * by];
}

function unit(v: Vec): Vec {
  const size = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / size, v[1] / size, v[2] / size];
}
