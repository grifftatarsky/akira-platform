import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

export interface CardSpec {

  readonly group: string;
  readonly count: number;

  readonly tall: number;

  readonly at: number;

  readonly out: number;

  readonly lean: number;

  readonly rows: number;

  readonly taper: number;

  readonly flat?: boolean;

  readonly trimStalk?: boolean;

  readonly centred?: number;

  readonly disc?: number;
}

export interface Plant {
  readonly id: string;
  readonly name: string;

  readonly note: string;

  readonly perArea: number;

  readonly tall: number;
  readonly wide: number;

  readonly head: number;

  readonly segments: number;

  readonly widest: number;
  readonly fullness: number;

  readonly blunt: number;

  readonly notch: number;

  readonly fold: number;

  readonly leaflets: number;

  readonly spread: number;

  readonly stem: number;

  readonly petals: number;

  readonly spikelets: number;

  readonly droop: number;
  readonly stiff: number;

  readonly base: readonly [number, number, number];
  readonly tip: readonly [number, number, number];

  readonly bloom: readonly [number, number, number];

  readonly blooms: boolean;

  readonly veins: number;
  readonly sweep: number;

  readonly lit: number;
  readonly wash?: readonly [number, number, number];

  readonly patch: number;
  readonly clumping: number;

  readonly crowd: number;
  readonly hold: number;

  readonly cards: readonly CardSpec[];

  readonly stemTall: number;

  readonly damp: number;
}

export const GRASS_FADE_FROM = 0.40;
export const GRASS_FADE_TO = 0.82;

export const MEADOW: readonly Plant[] = [
  {
    id: 'grass',
    name: 'Meadow grass',
    note: 'The mass of it. Widest low down and running out to a long point, '
      + 'with a crease along the midrib that catches the sun on one side only '
      + '— which is why a field of it glitters rather than sitting flat.',
    perArea: 1.21,
    tall: 3.0, wide: 0.34, head: 0, segments: 4,
    widest: 0.22, fullness: 0.85, blunt: 0.04, notch: 0, fold: 0.62,
    leaflets: 1, spread: 0, stem: 0, petals: 0, spikelets: 0,
    droop: 0.42, stiff: 1,
    base: [0.13, 0.30, 0.08], tip: [0.44, 0.63, 0.21], bloom: [0, 0, 0],
    veins: 0, sweep: 0,

    blooms: false,
    patch: 0.012, clumping: 1.0, crowd: 1.0, hold: 0.72,

    cards: [
      { group: 'blade', count: 9, tall: 3.0, at: 0, out: 0.06, lean: 0.90, rows: 3, taper: 1 },
      { group: 'spray', count: 1, tall: 3.4, at: 0, out: 0, lean: 0.06, rows: 5, taper: 1 },
    ],
    stemTall: 0,
    lit: 0.9, damp: 0,
  },
  {
    id: 'seed',
    name: 'Yorkshire fog',
    note: 'A panicle — a dense cluster of small spikelets on side branches, '
      + 'not a lump on a stick and not a starburst either: the real thing is '
      + 'soft and pinkish and reads as a mass. It stands a foot above '
      + 'everything else so the grass has no flat ceiling, and it is the first '
      + 'thing to catch a low sun.',
    perArea: 0.145,
    tall: 4.2, wide: 0.15, head: 0.42, segments: 4,
    widest: 0.2, fullness: 0.8, blunt: 0.04, notch: 0, fold: 0.4,
    leaflets: 3, spread: 0.62, stem: 0, petals: 0, spikelets: 16,
    droop: 0.8, stiff: 1.5,
    base: [0.20, 0.30, 0.10], tip: [0.62, 0.56, 0.38], bloom: [0.55, 0.47, 0.47],
    veins: 0, sweep: 0,

    blooms: false,
    patch: 0.022, clumping: 3.0, crowd: 2.4, hold: 0,

    cards: [
      { group: 'blade', count: 1, tall: 3.6, at: 0, out: 0.06, lean: 0.30, rows: 3, taper: 1 },
      { group: 'spray', count: 1, tall: 4.2, at: 0.2, out: 0, lean: 0.22, rows: 6, taper: 1 },
    ],
    stemTall: 2.4,
    lit: 0.86, damp: 0,
  },

  {
    id: 'clover',
    name: 'White clover',
    note: 'Three round leaflets, notched at the tip, meeting at the top of one '
      + 'stem and tilted out from it. The notch is the whole recognition — '
      + 'without it a clover leaf is a spade, and a spade is a weed nobody can '
      + 'name.',
    perArea: 0.67,
    tall: 0.95, wide: 0.52, head: 0, segments: 6,
    widest: 0.62, fullness: 1.05, blunt: 0.74, notch: 0.15, fold: 0.28,
    leaflets: 3, spread: 0.8, stem: 0.85, petals: 0, spikelets: 0,
    droop: 0.12, stiff: 0.35,
    base: [0.10, 0.26, 0.09], tip: [0.26, 0.50, 0.19], bloom: [0, 0, 0],
    veins: 0, sweep: 0,

    blooms: false,
    patch: 0.017, clumping: 2.0, crowd: 1.3, hold: 0.18,
    cards: [

      {
        group: 'clover', count: 1, tall: 0.52, at: 0.58, out: 0,
        lean: 0, rows: 2, taper: 1, flat: true, trimStalk: true, centred: 0.38,
      },
    ],
    stemTall: 0.58,
    lit: 0.64, damp: 0.5,
  },
  {
    id: 'plantain',
    name: 'Ribwort plantain',
    note: 'A rosette of long, ribbed leaves. Semi-erect and gathered, not '
      + 'splayed: flat rosettes are what it makes in short turf, and in a '
      + 'meadow it stands up to compete. Five parallel veins running the '
      + 'length of the leaf are what name it, and it grows where the grass has '
      + 'been trodden thin.',
    perArea: 0.67,
    tall: 2.1, wide: 0.31, head: 0, segments: 5,
    widest: 0.35, fullness: 0.95, blunt: 0.12, notch: 0, fold: 0.45,
    leaflets: 7, spread: 0.48, stem: 0.05, petals: 0, spikelets: 0,
    droop: 0.28, stiff: 0.3,
    base: [0.13, 0.24, 0.08], tip: [0.32, 0.47, 0.16], bloom: [0, 0, 0],
    veins: 5, sweep: 0.1,

    blooms: false,
    patch: 0.024, clumping: 2.0, crowd: 1.3, hold: 0.12,

    cards: [
      { group: 'rosette', count: 5, tall: 2.0, at: 0.04, out: 0.05, lean: 0.98, rows: 2, taper: 1 },
    ],
    stemTall: 0,
    lit: 0.68, damp: -0.3,
    wash: [0.70, 0.80, 0.46],
  },
];

interface Build {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

type Vec = readonly [number, number, number];

const LEAF_LIFT = 0.18;
const LEAF_FLOOR = 0.02;

export function plantGeometry(plant: Plant, detail = 1): VertexData {

  const coarse: Plant = detail >= 1 ? plant : {
    ...plant,
    segments: Math.max(1, Math.round(plant.segments * detail)),
    petals: plant.petals > 0 ? Math.max(5, Math.round(plant.petals * detail)) : 0,
    spikelets: plant.spikelets > 0
      ? Math.max(3, Math.round(plant.spikelets * detail)) : 0,
  };
  return fullGeometry(coarse);
}

function fullGeometry(plant: Plant): VertexData {
  const build: Build = { positions: [], normals: [], uvs: [], indices: [] };
  const heads = plant.petals > 0 || plant.spikelets > 0;

  const stalk = heads ? plant.tall : plant.stem;
  if (stalk > 0.02) {
    addStem(build, plant, stalk);
  }

  const leaves = plant.leaflets;
  const length = heads ? plant.tall * 0.42 : plant.tall - plant.stem;
  const from = heads ? plant.tall * 0.05 : plant.stem;

  for (let leaf = 0; leaf < leaves; leaf++) {

    const around = leaves === 1 ? 0
      : (leaf / leaves) * Math.PI * 2 + Math.sin(leaf * 12.9898) * 0.38;
    const lean = leaves === 1 ? 0
      : (heads ? 0.5 : plant.spread * (0.74 + 0.42 * fract(leaf * 0.7548)));
    addLeaf(build, plant, around, lean, from, length);
  }

  if (plant.spikelets > 0) {
    addPanicle(build, plant);
  }
  if (plant.petals > 0) {
    addFlower(build, plant);
  }

  const data = new VertexData();
  data.positions = build.positions;
  data.indices = build.indices;
  data.normals = build.normals;
  data.uvs = build.uvs;
  return data;
}

function addLeaf(
  build: Build, plant: Plant, around: number, lean: number,
  from: number, length: number,
): void {
  const rows = plant.segments + 1;
  const ca = Math.cos(around);
  const sa = Math.sin(around);
  const up: Vec = [Math.sin(lean) * ca, Math.cos(lean), Math.sin(lean) * sa];
  const across: Vec = [-sa, 0, ca];
  const face: Vec = [
    across[1] * up[2] - across[2] * up[1],
    across[2] * up[0] - across[0] * up[2],
    across[0] * up[1] - across[1] * up[0],
  ];

  const first = build.positions.length / 3;
  for (let row = 0; row < rows; row++) {
    const t = row / plant.segments;
    const half = outline(plant, t) * plant.wide * 0.5;

    const into = Math.max(0, (t - 0.66) / 0.34);
    const cleft = plant.notch * length * Math.pow(into, 2.1);
    const along = t * length;
    for (const column of [-1, 0, 1]) {
      const wide = half * column;
      const rise = column === 0 ? half * plant.fold : 0;
      const reach = along - (column === 0 ? cleft : 0);
      build.positions.push(
        up[0] * reach + across[0] * wide + face[0] * rise,
        from + up[1] * reach + across[1] * wide + face[1] * rise,
        up[2] * reach + across[2] * wide + face[2] * rise,
      );
      build.uvs.push(
        (column + 1) / 2, (from + along * up[1]) / plant.tall,
      );
      pushNormal(build, across, up, face, column);
    }
  }
  for (let row = 0; row < plant.segments; row++) {
    for (let column = 0; column < 2; column++) {
      const a = first + row * 3 + column;
      build.indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
    }
  }
}

function pushNormal(
  build: Build, across: Vec, up: Vec, face: Vec, column: number,
): void {
  const fx = across[0] * column * 0.85 + up[0] * 0.2 + face[0];
  const fy = across[1] * column * 0.85 + up[1] * 0.2 + face[1];
  const fz = across[2] * column * 0.85 + up[2] * 0.2 + face[2];
  const flat = Math.hypot(fx, fy, fz) || 1;
  const bx = (fx / flat) * (1 - LEAF_LIFT);
  const by = (fy / flat) * (1 - LEAF_LIFT) + LEAF_LIFT;
  const bz = (fz / flat) * (1 - LEAF_LIFT);
  const lifted = Math.hypot(bx, by, bz) || 1;
  const nx = bx / lifted;
  const ny = Math.max(by / lifted, LEAF_FLOOR);
  const nz = bz / lifted;
  const held = Math.hypot(nx, ny, nz) || 1;
  build.normals.push(nx / held, ny / held, nz / held);
}

export function outline(plant: Plant, at: number): number {
  const t = Math.max(0, Math.min(1, at));
  const rising = Math.pow(t / Math.max(0.001, plant.widest), plant.fullness);
  const falling = Math.pow(
    (1 - t) / Math.max(0.001, 1 - plant.widest), plant.fullness,
  );
  const body = Math.min(1, t < plant.widest ? rising : falling);
  const full = body * (1 - plant.blunt) + plant.blunt;

  return Math.max(0, plant.notch > 0 ? full : full * closeTip(t));
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function closeTip(t: number): number {
  return t > 0.92 ? Math.max(0, (1 - t) / 0.08) : 1;
}

function addStem(build: Build, plant: Plant, top: number): void {

  const thick = Math.max(0.016, plant.tall * 0.02);
  for (const turn of [0, Math.PI / 2]) {
    const ca = Math.cos(turn);
    const sa = Math.sin(turn);
    const first = build.positions.length / 3;
    for (const [height, taper] of [[0, 1], [top, 0.55]]) {
      for (const side of [-1, 1]) {
        const out = side * thick * taper;
        build.positions.push(ca * out, height, sa * out);
        build.uvs.push(side > 0 ? 1 : 0, height / plant.tall);
        build.normals.push(ca * side * 0.6, 0.74, sa * side * 0.6);
      }
    }
    build.indices.push(
      first, first + 1, first + 2, first + 1, first + 3, first + 2,
    );
  }
}

function addPanicle(build: Build, plant: Plant): void {
  const bottom = plant.tall * 0.64;
  const run = plant.tall - bottom;
  for (let i = 0; i < plant.spikelets; i++) {
    const t = i / Math.max(1, plant.spikelets - 1);
    const around = i * 2.399963;

    const out = plant.head * (0.3 + 0.7 * Math.sin(Math.PI * Math.pow(t, 0.7)));
    const ca = Math.cos(around);
    const sa = Math.sin(around);
    const rootY = bottom + run * t * 0.78;
    const tipY = rootY + run * 0.24;
    const first = build.positions.length / 3;
    for (let row = 0; row < 3; row++) {
      const along = row / 2;

      const fat = Math.sin(Math.PI * Math.pow(along, 0.55)) * plant.wide * 0.58;
      for (const side of [-1, 1]) {
        build.positions.push(
          ca * out * along - sa * side * fat,
          rootY + (tipY - rootY) * along,
          sa * out * along + ca * side * fat,
        );
        build.uvs.push(side > 0 ? 1 : 0, (rootY + (tipY - rootY) * along) / plant.tall);
        build.normals.push(ca * 0.35, 0.88, sa * 0.35);
      }
    }
    for (let row = 0; row < 2; row++) {
      const a = first + row * 2;
      build.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
}

function addFlower(build: Build, plant: Plant): void {
  const top = plant.tall;
  const disc = plant.head * 0.34;

  const tilt = 0.6;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const axis: Vec = [0, ct, st];
  const across: Vec = [1, 0, 0];
  const down: Vec = [0, -st, ct];

  const at = (r: number, a: number, lift: number): Vec => [
    across[0] * Math.cos(a) * r + down[0] * Math.sin(a) * r + axis[0] * lift,
    top + across[1] * Math.cos(a) * r + down[1] * Math.sin(a) * r + axis[1] * lift,
    across[2] * Math.cos(a) * r + down[2] * Math.sin(a) * r + axis[2] * lift,
  ];

  const centre = build.positions.length / 3;
  push(build, at(0, 0, disc * 0.42), axis, 0.5, 1);
  for (let i = 0; i <= plant.petals; i++) {
    const a = (i / plant.petals) * Math.PI * 2;
    push(build, at(disc, a, 0), axis, 0.5, 0.995);
  }
  for (let i = 0; i < plant.petals; i++) {
    build.indices.push(centre, centre + 1 + i, centre + 2 + i);
  }

  for (let i = 0; i < plant.petals; i++) {
    const a = (i / plant.petals) * Math.PI * 2 + 0.13;

    const stagger = i % 2 === 0 ? 1 : 0.86;
    const droop = plant.head * (0.2 + 0.1 * Math.sin(i * 2.3));
    const first = build.positions.length / 3;
    for (let row = 0; row < 3; row++) {
      const t = row / 2;
      const reach = disc + t * (plant.head * stagger - disc);
      const fat = plant.head * 0.17
        * Math.sin(Math.PI * Math.pow(0.25 + 0.75 * t, 0.75));
      for (const side of [-1, 1]) {
        const mid = at(reach, a, -droop * t * t);
        const edge = at(fat, a + Math.PI / 2, 0);
        push(build, [
          mid[0] + side * edge[0],
          mid[1] + side * (edge[1] - top),
          mid[2] + side * edge[2],
        ], axis, side > 0 ? 1 : 0, 0.97);
      }
    }
    for (let row = 0; row < 2; row++) {
      const b = first + row * 2;
      build.indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
}

function push(build: Build, at: Vec, normal: Vec, u: number, v: number): void {
  build.positions.push(at[0], at[1], at[2]);
  build.normals.push(normal[0], normal[1], normal[2]);
  build.uvs.push(u, v);
}

export function grassColor(plants: readonly Plant[] = MEADOW): [number, number, number] {
  const total = plants.reduce((sum, plant) => sum + plant.perArea, 0);
  const mixed: [number, number, number] = [0, 0, 0];
  for (const plant of plants) {
    const weight = plant.perArea / total;
    for (let channel = 0; channel < 3; channel++) {
      mixed[channel] += weight * (plant.base[channel] * 0.42 + plant.tip[channel] * 0.58);
    }
  }
  return mixed;
}

export function plantTriangles(plant: Plant): number {
  const heads = plant.petals > 0 || plant.spikelets > 0;

  const leaves = plant.leaflets;
  return leaves * plant.segments * 4
    + ((heads ? plant.tall : plant.stem) > 0.02 ? 4 : 0)
    + plant.spikelets * 4
    + (plant.petals > 0 ? plant.petals * 5 : 0);
}
