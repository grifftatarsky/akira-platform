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
  /**
   * How far a flower or seed head reaches from its stem, in half-feet.
   *
   * <p>Its own dimension, and that is the point. Scaling a head by the leaf's
   * width squashed a daisy's twelve petals into a sixth of a foot on a stem
   * more than a foot tall — every one of them present, counted in the
   * triangles, and invisible.
   */
  readonly head: number;

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
    tall: 3.0, wide: 0.34, head: 0, segments: 4,
    widest: 0.22, fullness: 0.85, blunt: 0.04, notch: 0, fold: 0.62,
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
    tall: 4.2, wide: 0.15, head: 0.42, segments: 4,
    widest: 0.2, fullness: 0.8, blunt: 0.04, notch: 0, fold: 0.4,
    leaflets: 1, spread: 0, stem: 0, petals: 0, spikelets: 11,
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
    tall: 1.5, wide: 0.52, head: 0, segments: 6,
    widest: 0.62, fullness: 1.05, blunt: 0.74, notch: 0.15, fold: 0.28,
    leaflets: 3, spread: 0.8, stem: 0.85, petals: 0, spikelets: 0,
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
    tall: 2.1, wide: 0.26, head: 0, segments: 5,
    widest: 0.35, fullness: 0.95, blunt: 0.12, notch: 0, fold: 0.45,
    leaflets: 6, spread: 0.62, stem: 0.05, petals: 0, spikelets: 0,
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
    share: 0.03,
    tall: 2.4, wide: 0.26, head: 0.34, segments: 3,
    widest: 0.3, fullness: 0.85, blunt: 0.08, notch: 0, fold: 0.35,
    leaflets: 1, spread: 0, stem: 1.9, petals: 12, spikelets: 0,
    droop: 0.22, stiff: 0.8,
    base: [0.16, 0.30, 0.10], tip: [0.30, 0.46, 0.16], bloom: [0.95, 0.94, 0.88],
    veins: 0, sweep: 0,
    wearMax: 0.5, damp: 0,
  },
];

/**
 * How hard every plant's normal is held above the horizon, after its
 * proportions have been baked in. Foliage is thin and scatters from both faces,
 * so it does not go dark when it turns away — a flat lambert is the wrong
 * physics for a leaf, and erring upward errs the way the real thing does.
 */

/** The lowest a leaf's normal is ever allowed to point. */

interface Build {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

type Vec = readonly [number, number, number];

/** How hard a leaf's normal is held above the horizon, and its hard floor. */
const LEAF_LIFT = 0.42;
const LEAF_FLOOR = 0.3;

/**
 * One plant, at true size in half-feet, rooted at the origin.
 *
 * <p><b>Built at true size rather than scaled at the end.</b> The generator
 * used to work in a unit cube and multiply by width and height afterwards,
 * which is fine for a blade — width and height are the only two dimensions a
 * blade has — and wrong for everything else. A daisy's head has a radius of its
 * own; scaling it by the leaf's width squashed twelve petals into a sixth of a
 * foot on a stem more than a foot tall. They were all there and all counted in
 * the triangles and none of them visible. A plantain's rosette collapsed the
 * same way, into a chevron.
 *
 * <p>Building at true size also leaves the normals correct as generated, with
 * no inverse-transpose rescale to undo — and that rescale is what was pushing
 * leaf normals under the horizon and shading them black.
 *
 * <p>The uv runs across the leaf in x and, in y, the height above the ground as
 * a fraction of the plant's own: what the wind shader reads to bend it, and
 * what the leaf texture reads to know whether it is drawing leaf or flower.
 */
export function plantGeometry(plant: Plant): VertexData {
  const build: Build = { positions: [], normals: [], uvs: [], indices: [] };
  const heads = plant.petals > 0 || plant.spikelets > 0;

  // <b>The stalk runs to the head, not to `stem`.</b> A flowering or seeding
  // plant is a stem with something on top of it; drawing the stem only as far
  // as the bare bit below the leaves left a daisy's head and a fog's panicle
  // hanging in the air with a hand's width of nothing under them. `stem` still
  // means what it says for a rosette, which is the only shape that has a bare
  // bit and then leaves.
  const stalk = heads ? plant.tall : plant.stem;
  if (stalk > 0.02) {
    addStem(build, plant, stalk);
  }

  // A flowering or seeding stem carries a couple of leaves low down; a rosette
  // is nothing but leaves.
  const leaves = heads ? 2 : plant.leaflets;
  const length = heads ? plant.tall * 0.42 : plant.tall - plant.stem;
  const from = heads ? plant.tall * 0.05 : plant.stem;

  for (let leaf = 0; leaf < leaves; leaf++) {
    // Evenly spaced and evenly leaned is a plus sign, and four of them in a
    // field is a pattern the eye picks out immediately. The jitter is a fixed
    // function of the index rather than a random number so the mesh is the
    // same every build — it is geometry, not a simulation.
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

/**
 * A leaf: `length` half-feet from `from`, `plant.wide` across.
 *
 * <p>Tilting it by `lean` carries its far end `sin(lean) * length` out from the
 * stem — a real distance, so a rosette is as wide as its leaves are long, the
 * way a rosette is.
 */
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
    // The notch: the midrib stops short of the edges, so the leaf ends in two
    // lobes with a cleft between them. It is the whole of a clover.
    // Over the last third, not the last sixth: at four segments a leaf has
    // one row above 0.84, so the whole heart of a clover was a single V. The
    // curve is steep because a clover's notch is a dimple in a round leaflet,
    // not a cleft — cut it linearly and the leaflet becomes a maple leaf.
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

/**
 * Fanned across the leaf so a flat surface shades like a curved one, then held
 * above the horizon.
 *
 * <p>Foliage is thin and scatters from both faces, so it does not go dark when
 * it turns away — a flat lambert is the wrong physics for a leaf, and erring
 * upward errs the way the real thing does. A normal pointing at the ground
 * takes the hemispheric light's ground colour, a dark brown that reads as black
 * whether the sun is up or not.
 */
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

/** How wide the leaf is a given fraction along it, as a fraction of `wide`. */
export function outline(plant: Plant, at: number): number {
  const t = Math.max(0, Math.min(1, at));
  const rising = Math.pow(t / Math.max(0.001, plant.widest), plant.fullness);
  const falling = Math.pow(
    (1 - t) / Math.max(0.001, 1 - plant.widest), plant.fullness,
  );
  const body = Math.min(1, t < plant.widest ? rising : falling);
  const full = body * (1 - plant.blunt) + plant.blunt;
  // <b>A notched leaf must not come to a point.</b> `closeTip` pinched every
  // leaf shut at its very end regardless of how blunt it was asked to be, so a
  // clover's cleft was a V pulled back from a point: present in the triangles,
  // invisible on screen. Where there is a notch, the width survives to the tip
  // and the notch is what ends the leaf.
  return Math.max(0, plant.notch > 0 ? full : full * closeTip(t));
}

/** The fractional part, for jitter that is a function of an index. */
function fract(x: number): number {
  return x - Math.floor(x);
}

/** Keeps a blunt leaf blunt until very near the tip, then closes it. */
function closeTip(t: number): number {
  return t > 0.92 ? Math.max(0, (1 - t) / 0.08) : 1;
}

/**
 * A stem from the ground to `top`: two quads crossed at right angles.
 *
 * <p>One quad is a ribbon, and a ribbon seen edge-on is nothing — a daisy
 * turned a few degrees the wrong way had a head floating over bare ground.
 * Four triangles buy a stem that is there from every direction, and the
 * normals radiate outward so it shades like a round thing rather than a card.
 */
function addStem(build: Build, plant: Plant, top: number): void {
  // Thickness follows the plant's height, not its leaf width. Clover has the
  // widest leaves in the meadow on one of the thinnest stalks, and scaling off
  // the leaf gave it a trunk.
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

/**
 * A panicle: spikelets on short side branches near the top.
 *
 * <p>Its reach is `head`, in half-feet, and not the leaf's width — which is the
 * difference between a cluster and an invisible smear up the stem.
 */
function addPanicle(build: Build, plant: Plant): void {
  const bottom = plant.tall * 0.64;
  const run = plant.tall - bottom;
  for (let i = 0; i < plant.spikelets; i++) {
    const t = i / Math.max(1, plant.spikelets - 1);
    const around = i * 2.399963;
    const out = plant.head * (0.35 + 0.65 * (1 - t));
    const ca = Math.cos(around);
    const sa = Math.sin(around);
    const rootY = bottom + run * t * 0.78;
    const tipY = rootY + run * 0.24;
    const first = build.positions.length / 3;
    for (let row = 0; row < 3; row++) {
      const along = row / 2;
      const fat = Math.sin(Math.PI * Math.pow(along, 0.55)) * plant.wide * 0.45;
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

/**
 * A flower head: ray florets around a disc, on top of the stem.
 *
 * <p>`head` half-feet from the middle to the end of a petal — about four inches
 * for a daisy. Real, and nothing to do with how wide its leaves are.
 */
function addFlower(build: Build, plant: Plant): void {
  const top = plant.tall;
  const disc = plant.head * 0.34;

  // <b>A daisy nods.</b> Built flat in the ground plane a head is a disc with
  // no thickness: from anywhere near eye level — which is where this camera
  // spends most of its time — twelve ray florets and eighty triangles of them
  // collapse into a line. Tipping the whole head back off vertical is what
  // makes a flower read as a flower rather than as a white speck.
  const tilt = 0.6;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const axis: Vec = [0, ct, st];      // the head's own up: its normal
  const across: Vec = [1, 0, 0];      // across its face
  const down: Vec = [0, -st, ct];     // the other direction in its face

  const at = (r: number, a: number, lift: number): Vec => [
    across[0] * Math.cos(a) * r + down[0] * Math.sin(a) * r + axis[0] * lift,
    top + across[1] * Math.cos(a) * r + down[1] * Math.sin(a) * r + axis[1] * lift,
    across[2] * Math.cos(a) * r + down[2] * Math.sin(a) * r + axis[2] * lift,
  ];

  // The disc: a shallow cone rather than a flat fan, so it catches the sun
  // across its face instead of all at once.
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
    // Every other floret sits a little lower and reaches a little further, so
    // the rim is a ragged real one and not a cog.
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

/** Triangles in one plant, for the sidebar to be honest about cost. */
export function plantTriangles(plant: Plant): number {
  const heads = plant.petals > 0 || plant.spikelets > 0;
  const leaves = heads ? 2 : plant.leaflets;
  return leaves * plant.segments * 4
    + ((heads ? plant.tall : plant.stem) > 0.02 ? 4 : 0)
    + plant.spikelets * 4
    + (plant.petals > 0 ? plant.petals * 5 : 0);
}
