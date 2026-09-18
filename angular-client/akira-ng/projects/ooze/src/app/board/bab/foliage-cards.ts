import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import { assetUrl } from './assets';
import type { CardSpec, Plant } from './species';

export interface Cut {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;

  readonly aspect: number;

  readonly spans: readonly (readonly [number, number])[];

  readonly stalk?: number;
}

export interface FoliageSheet {
  readonly texture: Texture;
  readonly groups: Readonly<Record<string, readonly Cut[]>>;
}

export async function loadFoliage(scene: Scene): Promise<FoliageSheet> {
  const table = await (await fetch(assetUrl('assets/board/foliage/foliage.json'))).json() as {
    groups: Record<string, Cut[]>;
  };

  const texture = new Texture(
    assetUrl('assets/board/foliage/foliage.png'), scene, false, false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );

  texture.anisotropicFilteringLevel = 8;
  texture.hasAlpha = true;
  return { texture, groups: table.groups };
}

interface Build {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

const LEAF_LIFT = 0.22;

const EDGE_FAN = Math.tan(0.3 * Math.PI);

const LEAF_FLOOR = 0.02;

export function cardGeometry(
  plant: Plant, sheet: FoliageSheet,
): VertexData {
  const build: Build = { positions: [], normals: [], uvs: [], indices: [] };
  const leaves = plant.cards.reduce(
    (sum, spec) => sum + (spec.disc ? 0 : spec.count), 0,
  );
  let placed = 0;
  let leafed = 0;

  for (const spec of plant.cards) {
    const cuts = sheet.groups[spec.group];
    if (!cuts?.length) {
      continue;
    }
    for (let n = 0; n < spec.count; n++) {
      const around = spec.disc
        ? Math.sin(placed * 7.3) * 0.9
        : (leafed / Math.max(1, leaves)) * Math.PI
          + Math.sin(leafed * 12.9898 + placed) * (Math.PI / leaves) * 0.22;
      const cut = cuts[(spec.disc ? placed : leafed) % cuts.length];
      if (spec.disc) {
        addHead(build, spec, cut, around);
      } else {
        addCard(build, plant, spec, cut, around, leafed);
        leafed++;
      }
      placed++;
    }
  }

  if (plant.stemTall > 0.02) {
    addStem(build, plant, sheet);
  }

  const data = new VertexData();
  data.positions = build.positions;
  data.normals = build.normals;
  data.uvs = build.uvs;
  data.indices = build.indices;
  return data;
}

function addCard(
  build: Build, plant: Plant, spec: CardSpec, cut: Cut,
  around: number, index: number,
): void {
  const wide = spec.tall * cut.aspect;

  const vary = 1 + Math.sin(index * 5.17 + spec.tall) * 0.12;
  const tall = spec.tall * vary;

  const ca = Math.cos(around);
  const sa = Math.sin(around);

  const lean = spec.flat
    ? Math.PI / 2
    : spec.lean * (0.3 + 1.4 * fract(index * 0.6180339887));
  const cl = Math.cos(lean);
  const sl = Math.sin(lean);
  const across: Vec = [ca, 0, -sa];
  const up: Vec = [sa * sl, cl, ca * sl];
  const face: Vec = cross(across, up);

  const rows = Math.max(1, spec.rows);
  const mirror = index % 2 === 1;

  const base = spec.trimStalk ? stalkTop(cut) : 0;

  const sink = tall * (spec.centred ?? 0);
  const root: Vec = [
    sa * spec.out - up[0] * sink,
    spec.at - up[1] * sink,
    ca * spec.out - up[2] * sink,
  ];
  const first = build.positions.length / 3;

  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const along = tall * t;

    const s = base + (1 - base) * t;
    const step = ((1 - base) * 0.5) / rows;

    const edge = spanOver(cut, s - step, s + step);
    for (const side of [0, 1] as const) {
      const at = mirror ? 1 - edge[1 - side] : edge[side];
      const off = (at - 0.5) * wide * vary;
      build.positions.push(
        root[0] + up[0] * along + across[0] * off,
        root[1] + up[1] * along + across[1] * off,
        root[2] + up[2] * along + across[2] * off,
      );

      const fanned = add(face, scale(across, EDGE_FAN * (side === 0 ? -1 : 1)));
      build.normals.push(...lift(fanned));
      build.uvs.push(
        cut.u0 + (cut.u1 - cut.u0) * at,
        cut.v1 + (cut.v0 - cut.v1) * s,
      );
    }
  }
  for (let row = 0; row < rows; row++) {
    const a = first + row * 2;
    build.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

function addHead(build: Build, spec: CardSpec, cut: Cut, around: number): void {
  const segments = Math.max(3, spec.disc ?? 9);
  const radius = spec.tall * 0.5;
  const ca = Math.cos(around);
  const sa = Math.sin(around);
  const lean = spec.flat ? Math.PI / 2 : spec.lean;
  const cl = Math.cos(lean);
  const sl = Math.sin(lean);

  const across: Vec = [ca, 0, -sa];
  const up: Vec = [sa * sl, cl, ca * sl];
  const face: Vec = cross(across, up);

  const skyward = face[1] < 0 ? -1 : 1;
  const dish = radius * 0.22 * skyward;

  const centre = build.positions.length / 3;
  build.positions.push(0, spec.at, 0);
  build.normals.push(...lift([face[0] * skyward, face[1] * skyward, face[2] * skyward]));
  build.uvs.push((cut.u0 + cut.u1) / 2, (cut.v0 + cut.v1) / 2);

  for (let at = 0; at <= segments; at++) {
    const turn = (at / segments) * Math.PI * 2;
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    build.positions.push(
      (across[0] * cs + up[0] * sn) * radius + face[0] * dish,
      spec.at + (across[1] * cs + up[1] * sn) * radius + face[1] * dish,
      (across[2] * cs + up[2] * sn) * radius + face[2] * dish,
    );

    const out: Vec = [
      face[0] * skyward + (across[0] * cs + up[0] * sn) * 0.45,
      face[1] * skyward + (across[1] * cs + up[1] * sn) * 0.45,
      face[2] * skyward + (across[2] * cs + up[2] * sn) * 0.45,
    ];
    build.normals.push(...lift(out));

    build.uvs.push(
      cut.u0 + (cut.u1 - cut.u0) * (0.5 + 0.5 * cs),
      cut.v1 + (cut.v0 - cut.v1) * (0.5 + 0.5 * sn),
    );
  }
  for (let at = 0; at < segments; at++) {
    build.indices.push(centre, centre + 1 + at, centre + 2 + at);
  }
}

function addStem(build: Build, plant: Plant, sheet: FoliageSheet): void {
  const blade = sheet.groups['blade']?.[0];
  if (!blade) {
    return;
  }
  const u = (blade.u0 + blade.u1) / 2;
  const v0 = blade.v1 - (blade.v1 - blade.v0) * 0.1;
  const v1 = blade.v1 - (blade.v1 - blade.v0) * 0.9;
  const thick = Math.max(0.014, plant.tall * 0.016);
  const top = plant.stemTall;

  for (const turn of [0, Math.PI / 2]) {
    const cx = Math.cos(turn) * thick;
    const cz = Math.sin(turn) * thick;
    const first = build.positions.length / 3;
    for (const height of [0, top]) {
      for (const side of [-1, 1] as const) {
        build.positions.push(cx * side, height, cz * side);
        build.normals.push(...lift([-cz, 0, cx] as Vec));
        build.uvs.push(u, height === 0 ? v0 : v1);
      }
    }
    build.indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function stalkTop(cut: Cut): number {
  return Math.max(0, Math.min(0.9, cut.stalk ?? 0));
}

function spanOver(cut: Cut, from: number, to: number): readonly [number, number] {
  const spans = cut.spans;
  if (!spans?.length) {
    return [0, 1];
  }
  const last = spans.length - 1;
  const lo = Math.max(0, Math.min(last, from * last));
  const hi = Math.max(0, Math.min(last, to * last));
  let left = 1;
  let right = 0;

  for (const t of [lo, hi]) {
    const edge = spanAt(cut, t / last);
    left = Math.min(left, edge[0]);
    right = Math.max(right, edge[1]);
  }
  for (let at = Math.ceil(lo); at <= Math.floor(hi); at++) {
    left = Math.min(left, spans[at][0]);
    right = Math.max(right, spans[at][1]);
  }
  return left < right ? [left, right] : [0, 1];
}

function spanAt(cut: Cut, t: number): readonly [number, number] {
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

type Vec = readonly [number, number, number];

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

function lift(v: Vec): Vec {
  const flat = Math.hypot(v[0], v[1], v[2]) || 1;
  const x = (v[0] / flat) * (1 - LEAF_LIFT);
  const y = (v[1] / flat) * (1 - LEAF_LIFT) + LEAF_LIFT;
  const z = (v[2] / flat) * (1 - LEAF_LIFT);
  const long = Math.hypot(x, y, z) || 1;

  const held = Math.max(y / long, LEAF_FLOOR);
  const side = Math.hypot(x, z) / long;
  const wanted = Math.sqrt(Math.max(0, 1 - held * held));
  const scale = side > 1e-9 ? wanted / side : 0;
  return [(x / long) * scale, held, (z / long) * scale];
}
