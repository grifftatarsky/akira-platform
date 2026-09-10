import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

/**
 * What grows in a meadow, and the shape of it.
 *
 * <p>Every plant is built from one generator, and the generator is a *leaf*
 * rather than a strip: three columns of vertices — left edge, midrib, right
 * edge — so a leaf can have a crease down its middle, a notch at its tip and
 * an outline that is not simply a taper. That is the difference between a
 * clover and a green spade, and a strip cannot express it at any width.
 *
 * <p>Flower heads and seed heads are their own small structures on top of that,
 * because a daisy is not a leaf with a pale end and a panicle is not a bulge.
 *
 * <p><b>Segment counts are low and deliberately so.</b> Three columns of
 * vertices is twice the triangles per row that two were, and at six hundred
 * thousand plants that took the frame from 8 ms to 30. The rows bought less
 * than the columns did — a crease down the middle changes how every blade
 * catches the light, where a sixth row along its length changes a silhouette
 * nobody is close enough to read.
 */

export interface Plant {
  readonly id: string;
  readonly name: string;
  /** For the sidebar, so a shape can be argued with. */
  readonly note: string;

  /** Share of the meadow's plants, roughly. Normalised across the table. */
  readonly share: number;

  /** Half-feet, before the clump's own scaling. */
  readonly tall: number;
  readonly wide: number;

  /** Segments up one leaf. More only matters where the thing curves. */
  readonly segments: number;

  /**
   * Where the widest point sits, as a fraction of the way up, and how full the
   * outline is on either side of it. A blade is widest low and runs to a long
   * point; a clover leaflet is widest past halfway and comes back in.
   */
  readonly widest: number;
  readonly fullness: number;
  /** How much of the width survives at the very tip. Zero is a point. */
  readonly blunt: number;
  /**
   * How far the tip is cut back into the leaf, as a fraction of its length. A
   * clover's heart-shaped notch is the single thing that identifies it.
   */
  readonly notch: number;
  /** How far the midrib stands above the plane of the edges. A crease. */
  readonly fold: number;

  /** One for a blade, three for a clover, four or five for a rosette. */
  readonly leaflets: number;
  /** How far the leaflets tilt away from vertical, in radians. */
  readonly spread: number;
  /** Fraction of the height that is bare stem below the leaves. */
  readonly stem: number;

  /** Ray florets around a disc, for anything that flowers. */
  readonly petals: number;
  /** Spikelets clustered at the top, for a seed head. */
  readonly spikelets: number;

  /** How far it bends of its own accord, and how much the wind moves it. */
  readonly droop: number;
  readonly stiff: number;

  readonly base: readonly [number, number, number];
  readonly tip: readonly [number, number, number];
  /** Ray florets, where there are any. */
  readonly bloom: readonly [number, number, number];

  /** Veins across the leaf, and how far they sweep toward the tip. */
  readonly veins: number;
  readonly sweep: number;

  /** Will not grow where the ground is more worn than this. 0 lush, 1 bare. */
  readonly wearMax: number;
  /** Prefers damp (1), dry (-1), or does not mind (0). */
  readonly damp: number;
}

/** A summer meadow on the Virginia piedmont. */
export const MEADOW: readonly Plant[] = [
  {
    id: 'grass',
    name: 'Meadow grass',
    note: 'The mass of it. Widest low down and running out to a long point, '
      + 'with a crease along the midrib that catches the sun on one side only '
      + '— which is why a field of it glitters rather than sitting flat.',
    share: 0.55,
    tall: 3.0, wide: 0.18, segments: 4,
    widest: 0.22, fullness: 0.85, blunt: 0.04, notch: 0, fold: 0.55,
    leaflets: 1, spread: 0, stem: 0, petals: 0, spikelets: 0,
    droop: 0.42, stiff: 1,
    base: [0.13, 0.30, 0.08], tip: [0.44, 0.63, 0.21], bloom: [0, 0, 0],
    veins: 0, sweep: 0,
    wearMax: 0.62, damp: 0,
  },
  {
    id: 'seed',
    name: 'Yorkshire fog',
    note: 'A panicle — a cluster of small spikelets on side branches, not a '
      + 'lump on a stick. It stands a foot above everything else so the sward '
      + 'has no flat ceiling, and it is the first thing to catch a low sun.',
    share: 0.08,
    tall: 4.4, wide: 0.13, segments: 4,
    widest: 0.18, fullness: 0.7, blunt: 0.03, notch: 0, fold: 0.4,
    leaflets: 1, spread: 0, stem: 0, petals: 0, spikelets: 8,
    droop: 0.8, stiff: 1.5,
    base: [0.20, 0.30, 0.10], tip: [0.62, 0.56, 0.38], bloom: [0.74, 0.66, 0.56],
    veins: 0, sweep: 0,
    wearMax: 0.45, damp: 0,
  },
  {
    id: 'clover',
    name: 'White clover',
    note: 'Three round leaflets, notched at the tip, meeting at the top of one '
      + 'stem and tilted out from it. The notch is the whole recognition — '
      + 'without it a clover leaf is a spade, and a spade is a weed nobody can '
      + 'name.',
    share: 0.18,
    tall: 1.2, wide: 0.44, segments: 4,
    widest: 0.62, fullness: 1.55, blunt: 0.72, notch: 0.2, fold: 0.3,
    leaflets: 3, spread: 0.72, stem: 0.52, petals: 0, spikelets: 0,
    droop: 0.12, stiff: 0.35,
    base: [0.10, 0.26, 0.09], tip: [0.26, 0.50, 0.19], bloom: [0, 0, 0],
    veins: 0, sweep: 0,
    wearMax: 0.78, damp: 0.5,
  },
  {
    id: 'plantain',
    name: 'Ribwort plantain',
    note: 'A rosette of long, narrow, deeply ribbed leaves lying well out from '
      + 'the centre. Five parallel veins running the length of the leaf are '
      + 'what name it, and it grows where the grass has been trodden thin.',
    share: 0.13,
    tall: 1.9, wide: 0.22, segments: 5,
    widest: 0.38, fullness: 0.95, blunt: 0.1, notch: 0, fold: 0.5,
    leaflets: 4, spread: 1.05, stem: 0.04, petals: 0, spikelets: 0,
    droop: 0.28, stiff: 0.3,
    base: [0.13, 0.24, 0.08], tip: [0.32, 0.47, 0.16], bloom: [0, 0, 0],
    veins: 5, sweep: 0.1,
    wearMax: 0.92, damp: -0.3,
  },
  {
    id: 'daisy',
    name: 'Oxeye daisy',
    note: 'A real head: twelve white ray florets around a yellow disc, on a '
      + 'thin stem. Rare on purpose — scattered white reads as flowers, evenly '
      + 'spread white reads as litter.',
    share: 0.06,
    tall: 2.4, wide: 0.16, segments: 3,
    widest: 0.3, fullness: 0.8, blunt: 0.06, notch: 0, fold: 0.35,
    leaflets: 1, spread: 0, stem: 0.78, petals: 12, spikelets: 0,
    droop: 0.22, stiff: 0.8,
    base: [0.16, 0.30, 0.10], tip: [0.30, 0.46, 0.16], bloom: [0.95, 0.94, 0.88],
    veins: 0, sweep: 0,
    wearMax: 0.5, damp: 0,
  },
];

interface Build {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/**
 * One plant, as geometry.
 *
 * <p>Built around the origin at the root and one unit tall, so the instance
 * matrix carries all of the size and every species shares one shader. The uv
 * runs across the leaf in x and along it in y — the wind shader reads the y for
 * the height up the plant, and the leaf texture uses both.
 */
export function plantGeometry(plant: Plant): VertexData {
  const build: Build = { positions: [], normals: [], uvs: [], indices: [] };

  const heads = plant.petals > 0 || plant.spikelets > 0;
  // A flowering stem carries one leaf low down; a rosette carries all of them.
  const leaves = heads ? 1 : plant.leaflets;

  for (let leaf = 0; leaf < leaves; leaf++) {
    const around = leaves === 1 ? 0 : (leaf / leaves) * Math.PI * 2;
    const lean = leaves === 1 ? 0 : plant.spread;
    addLeaf(build, plant, around, lean, heads ? 0 : plant.stem, heads ? 0.55 : 1);
  }

  if (plant.stem > 0.02) {
    addStem(build, plant);
  }
  if (plant.spikelets > 0) {
    addPanicle(build, plant);
  }
  if (plant.petals > 0) {
    addFlower(build, plant);
  }

  // <b>The plant's proportions are baked in here, not carried by the instance
  // matrix.</b> A matrix that scales width and height differently is
  // non-uniform, and a normal transformed by such a matrix is wrong unless the
  // inverse transpose is used instead — which Babylon does, but only when it
  // knows the scaling is non-uniform, and it cannot know that of a matrix
  // supplied per instance. The result was clover leaflets shading black on
  // whichever side the skew pushed their normal past the horizon, in the field
  // but never in the preview, where the same geometry is drawn with a scale
  // Babylon can see.
  //
  // <p>With the shape baked in, the instance matrix is a rotation and one
  // uniform scale, and a rotation cannot skew a normal at all.
  const wide = plant.wide;
  const tall = plant.tall;
  for (let i = 0; i < build.positions.length; i += 3) {
    build.positions[i] *= wide;
    build.positions[i + 1] *= tall;
    build.positions[i + 2] *= wide;
    // The inverse transpose of a diagonal scale is the reciprocal of it.
    const nx = build.normals[i] / wide;
    const ny = build.normals[i + 1] / tall;
    const nz = build.normals[i + 2] / wide;
    const length = Math.hypot(nx, ny, nz) || 1;
    build.normals[i] = nx / length;
    build.normals[i + 1] = ny / length;
    build.normals[i + 2] = nz / length;
  }

  const data = new VertexData();
  data.positions = build.positions;
  data.indices = build.indices;
  data.normals = build.normals;
  data.uvs = build.uvs;
  return data;
}

/**
 * A leaf: three columns of vertices, so it has a middle.
 *
 * <p>The midrib column stands proud of the two edges by `fold`, which is what
 * gives a blade a crease and a leaf a spine. Without it a leaf is a flat card
 * and shades like one — every one in a clump catching the sun identically. The
 * tip is cut back into the leaf by `notch`, which is the entire difference
 * between a clover leaflet and a spade.
 */
function addLeaf(
  build: Build, plant: Plant, around: number, lean: number,
  stem: number, scale: number,
): void {
  const rows = plant.segments + 1;
  const ca = Math.cos(around);
  const sa = Math.sin(around);
  const up: [number, number, number] = [
    Math.sin(lean) * ca, Math.cos(lean), Math.sin(lean) * sa,
  ];
  const across: [number, number, number] = [-sa, 0, ca];
  const face: [number, number, number] = [
    across[1] * up[2] - across[2] * up[1],
    across[2] * up[0] - across[0] * up[2],
    across[0] * up[1] - across[1] * up[0],
  ];

  const first = build.positions.length / 3;
  for (let row = 0; row < rows; row++) {
    const t = row / plant.segments;
    const half = outline(plant, t) * 0.5;
    // The notch: the midrib stops short of the edges at the tip, so the leaf
    // ends in two lobes with a cleft between them.
    const cleft = plant.notch * Math.max(0, t - 0.86) / 0.14;
    for (const column of [-1, 0, 1]) {
      const wide = half * column;
      const rise = column === 0 ? half * plant.fold : 0;
      const along = (stem + (1 - stem) * t) * scale;
      const height = along - (column === 0 ? cleft : 0) * scale;
      build.positions.push(
        up[0] * height + across[0] * wide + face[0] * rise,
        up[1] * height + across[1] * wide + face[1] * rise,
        up[2] * height + across[2] * wide + face[2] * rise,
      );
      build.uvs.push((column + 1) / 2, along);
      // Fanned across the leaf so a flat surface shades like a curved one, and
      // held well above the horizon: a leaf tilted past horizontal has a face
      // vector pointing under itself, and a normal pointing at the ground is
      // black under a midday sun.
      pushNormal(build, plant, across, up, face, column);
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
  build: Build, plant: Plant,
  across: readonly number[], up: readonly number[], face: readonly number[],
  column: number,
): void {
  const bias = plant.leaflets > 1 || plant.spread > 0 ? 0.6 : 0.18;
  const fx = across[0] * column * 0.85 + up[0] * 0.25 + face[0];
  const fy = across[1] * column * 0.85 + up[1] * 0.25 + face[1];
  const fz = across[2] * column * 0.85 + up[2] * 0.25 + face[2];
  const flat = Math.hypot(fx, fy, fz) || 1;
  const nx = (fx / flat) * (1 - bias);
  const ny = (fy / flat) * (1 - bias) + bias;
  const nz = (fz / flat) * (1 - bias);
  const length = Math.hypot(nx, ny, nz) || 1;
  build.normals.push(nx / length, ny / length, nz / length);
}

/** The outline of a leaf: how wide it is a given fraction of the way up. */
export function outline(plant: Plant, at: number): number {
  const t = Math.max(0, Math.min(1, at));
  // A power curve either side of the widest point, so the shape can be a blade
  // (widest low, long taper) or a leaflet (widest high, coming back in).
  const rising = Math.pow(t / Math.max(0.001, plant.widest), plant.fullness);
  const falling = Math.pow(
    (1 - t) / Math.max(0.001, 1 - plant.widest), plant.fullness,
  );
  const body = Math.min(1, t < plant.widest ? rising : falling);
  return Math.max(0, body * (1 - plant.blunt) + plant.blunt * smoothTip(t));
}

/** Keeps a blunt leaf blunt until very near the tip, then closes it. */
function smoothTip(t: number): number {
  return t > 0.94 ? Math.max(0, (1 - t) / 0.06) : 1;
}

/** A bare stem, where the leaves or the head stand off the ground on one. */
function addStem(build: Build, plant: Plant): void {
  const first = build.positions.length / 3;
  const thin = 0.09;
  for (const height of [0, plant.stem]) {
    for (const side of [-1, 1]) {
      build.positions.push(side * thin, height, 0);
      build.uvs.push(side > 0 ? 1 : 0, height);
      build.normals.push(side * 0.42, 0.62, 0.56);
    }
  }
  build.indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
}

/**
 * A panicle: spikelets on short side branches near the top.
 *
 * <p>A seed head is a cluster, not a swelling. Drawn as a spray of small
 * tapering blades angled up and out from the stem, which is enough at the size
 * anybody sees one — and enough to break the silhouette, which is the job.
 */
function addPanicle(build: Build, plant: Plant): void {
  for (let i = 0; i < plant.spikelets; i++) {
    const at = 0.62 + 0.36 * (i / plant.spikelets);
    const around = i * 2.399963;
    const out = 0.55 + 0.45 * Math.sin(i * 1.7);
    const first = build.positions.length / 3;
    const ca = Math.cos(around) * out;
    const sa = Math.sin(around) * out;
    const length = 0.16 * (1 - (at - 0.62) / 0.5);
    for (let row = 0; row < 3; row++) {
      const t = row / 2;
      const half = 0.5 * Math.sin(Math.PI * Math.pow(t, 0.5)) * 0.55;
      for (const side of [-1, 1]) {
        build.positions.push(
          ca * t * length * 6 + side * half * 0.4,
          at + t * length * 2.4,
          sa * t * length * 6,
        );
        build.uvs.push(side > 0 ? 1 : 0, at + t * length * 2.4);
        build.normals.push(ca * 0.4, 0.8, sa * 0.4);
      }
    }
    for (let row = 0; row < 2; row++) {
      const a = first + row * 2;
      build.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
}

/**
 * A flower head: ray florets around a disc.
 *
 * <p>Not a pale end on a stem. The petals lie almost flat and radiate, the disc
 * is a small fan in the middle, and the whole thing sits on top of the stem —
 * which is what makes a daisy read as a daisy from ten feet up.
 */
function addFlower(build: Build, plant: Plant): void {
  const top = 1;
  const disc = 0.34;

  // The disc, as a fan.
  const centre = build.positions.length / 3;
  build.positions.push(0, top + 0.03, 0);
  build.uvs.push(0.5, top + 0.03);
  build.normals.push(0, 1, 0);
  for (let i = 0; i <= plant.petals; i++) {
    const a = (i / plant.petals) * Math.PI * 2;
    build.positions.push(Math.cos(a) * disc, top, Math.sin(a) * disc);
    build.uvs.push(0.5, top);
    build.normals.push(Math.cos(a) * 0.25, 0.97, Math.sin(a) * 0.25);
  }
  for (let i = 0; i < plant.petals; i++) {
    build.indices.push(centre, centre + 1 + i, centre + 2 + i);
  }

  // The rays, each a narrow leaf lying nearly flat.
  for (let i = 0; i < plant.petals; i++) {
    const a = (i / plant.petals) * Math.PI * 2 + 0.11;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const droop = 0.1 + 0.06 * Math.sin(i * 2.3);
    const first = build.positions.length / 3;
    for (let row = 0; row < 3; row++) {
      const t = row / 2;
      const reach = disc + t * 0.72;
      const half = 0.12 * Math.sin(Math.PI * Math.pow(0.2 + 0.8 * t, 0.8));
      for (const side of [-1, 1]) {
        build.positions.push(
          ca * reach - sa * side * half,
          top - droop * t * t,
          sa * reach + ca * side * half,
        );
        // Along the petal, and into the pale end of the leaf texture.
        build.uvs.push(side > 0 ? 1 : 0, top - droop * t * t);
        build.normals.push(ca * 0.12, 0.98, sa * 0.12);
      }
    }
    for (let row = 0; row < 2; row++) {
      const b = first + row * 2;
      build.indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
}

/** Triangles in one plant, for the sidebar to be honest about cost. */
export function plantTriangles(plant: Plant): number {
  const heads = plant.petals > 0 || plant.spikelets > 0;
  const leaves = heads ? 1 : plant.leaflets;
  return leaves * plant.segments * 4
    + (plant.stem > 0.02 ? 2 : 0)
    + plant.spikelets * 4
    + (plant.petals > 0 ? plant.petals * 5 : 0);
}
