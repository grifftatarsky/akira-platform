import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

/**
 * What grows in a meadow, and the shape of it.
 *
 * <p>The old renderer had five species and this one had one, which is most of
 * why a field of it reads as a green surface rather than as ground. A real
 * sward is grass by area and everything else by interest: the clover and the
 * plantain are what the eye lands on, and they are the things that say the
 * scale of the picture.
 *
 * <p>Every plant here is built from one generator — a strip whose width
 * follows a curve, repeated as leaflets around a stem. That is enough for a
 * blade of grass (one leaflet, narrow, tall), a clover (three leaflets, round,
 * low) and a seed head (one leaflet with a bulge near the top), and keeping it
 * to one generator is what makes a sixth species a table entry rather than a
 * modelling session.
 */

export interface Plant {
  readonly id: string;
  readonly name: string;
  /** For the sidebar, so a shape can be argued with. */
  readonly note: string;

  /** Share of the meadow's blades, roughly. Normalised across the table. */
  readonly share: number;

  /** Half-feet, before the clump's own scaling. */
  readonly tall: number;
  readonly wide: number;

  /** Segments up one leaflet. More only matters where the thing curves. */
  readonly segments: number;
  /**
   * Where the width sits. Below one puts the widest point low and tapers to a
   * long point — a blade of grass. Above one rounds it into a leaf.
   */
  readonly leaf: number;
  /** How much narrower the tip is than the profile alone would make it. */
  readonly taper: number;
  /** An extra swelling near the top, for a seed head. Zero for a leaf. */
  readonly head: number;

  /** One for grass, three for clover. */
  readonly leaflets: number;
  /** How far the leaflets tilt away from vertical, in radians. */
  readonly spread: number;
  /** Fraction of the height that is bare stem below the leaflets. */
  readonly stem: number;

  /** How far it bends of its own accord, and how much the wind moves it. */
  readonly droop: number;
  readonly stiff: number;

  readonly base: readonly [number, number, number];
  readonly tip: readonly [number, number, number];

  /** Will not grow where the ground is more worn than this. 0 lush, 1 bare. */
  readonly wearMax: number;
  /** Prefers damp (1), dry (-1), or does not mind (0). */
  readonly damp: number;
}

/**
 * A summer meadow on the Virginia piedmont.
 *
 * <p>Shares are by count, not by area, so the clover reads as far more of the
 * ground than its sixth suggests — a clover leaf covers thirty times what a
 * blade edge-on does.
 */
export const MEADOW: readonly Plant[] = [
  {
    id: 'grass',
    name: 'Meadow grass',
    note: 'The mass of it. Narrow, tall, curving over at the tip — the thing '
      + 'the whole field is made of, and the only one whose silhouette anybody '
      + 'reads individually.',
    share: 0.56,
    tall: 3.0, wide: 0.17, segments: 6, leaf: 0.62, taper: 0.15, head: 0,
    leaflets: 1, spread: 0, stem: 0,
    droop: 0.42, stiff: 1,
    base: [0.13, 0.30, 0.08], tip: [0.42, 0.62, 0.20],
    wearMax: 0.62, damp: 0,
  },
  {
    id: 'seed',
    name: 'Yorkshire fog',
    note: 'A seed head on a bare stem, standing a foot above everything else. '
      + 'Its job is the top edge of the field: without something taller than '
      + 'the grass the sward has a flat ceiling and reads as mown.',
    share: 0.08,
    tall: 4.4, wide: 0.11, segments: 8, leaf: 0.5, taper: 0.55, head: 0.55,
    leaflets: 1, spread: 0, stem: 0,
    droop: 0.8, stiff: 1.5,
    base: [0.20, 0.30, 0.10], tip: [0.66, 0.58, 0.36],
    wearMax: 0.45, damp: 0,
  },
  {
    id: 'clover',
    name: 'White clover',
    note: 'Three round leaflets on a short stem, tilted out from it. A clover '
      + 'is not a wide blade — the shape is the whole recognition, and one '
      + 'rounded leaf reads as a weed nobody can name.',
    share: 0.18,
    tall: 1.1, wide: 0.40, segments: 5, leaf: 1.6, taper: -0.1, head: 0,
    leaflets: 3, spread: 0.62, stem: 0.45,
    droop: 0.12, stiff: 0.35,
    base: [0.11, 0.26, 0.09], tip: [0.28, 0.52, 0.20],
    wearMax: 0.78, damp: 0.5,
  },
  {
    id: 'plantain',
    name: 'Ribwort plantain',
    note: 'A rosette of long ribbed leaves lying almost flat. It grows where '
      + 'the grass has been trodden thin, which is why it belongs against the '
      + 'edge of the road rather than out in the field.',
    share: 0.13,
    tall: 1.5, wide: 0.34, segments: 5, leaf: 1.15, taper: 0.3, head: 0,
    leaflets: 4, spread: 0.82, stem: 0.05,
    droop: 0.2, stiff: 0.3,
    base: [0.14, 0.24, 0.08], tip: [0.34, 0.48, 0.16],
    wearMax: 0.92, damp: -0.3,
  },
  {
    id: 'daisy',
    name: 'Oxeye daisy',
    note: 'A pale head on a thin stem, and the only bright thing out there. '
      + 'Rare on purpose: scattered white reads as flowers, evenly spread '
      + 'white reads as litter.',
    share: 0.05,
    tall: 2.2, wide: 0.30, segments: 6, leaf: 0.45, taper: 0.7, head: 0.7,
    leaflets: 1, spread: 0, stem: 0,
    droop: 0.25, stiff: 0.8,
    base: [0.16, 0.30, 0.10], tip: [0.92, 0.90, 0.80],
    wearMax: 0.5, damp: 0,
  },
];

/**
 * One plant, as geometry.
 *
 * <p>Built around the origin at the root and one unit tall, so the instance
 * matrix carries all of the size and every species shares one set of shader
 * code. Local Y is the height up the plant, which is what the wind plugin
 * reads — the geometry has no UVs and does not need any.
 */
export function plantGeometry(plant: Plant): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // <b>The height fraction, carried explicitly.</b> The wind shader needs to
  // know how far up the plant a vertex is, and it used to read the local Y —
  // which is only the same thing for a single upright blade. A leaflet tilted
  // out from a stem has a local Y of its own, so the shader was bending the
  // clover by the wrong amount and, worse, overwriting that Y and flattening
  // the leaflet into the ground.
  const uvs: number[] = [];

  const rows = plant.segments + 1;
  const stem = plant.stem;

  for (let leaflet = 0; leaflet < plant.leaflets; leaflet++) {
    // Leaflets fan evenly around the stem, tilted out by `spread`. A single
    // leaflet stays upright and pointing along +Z, which is what makes grass a
    // special case of the same code rather than a second path.
    const around = plant.leaflets === 1 ? 0 : (leaflet / plant.leaflets) * Math.PI * 2;
    const lean = plant.leaflets === 1 ? 0 : plant.spread;
    const ca = Math.cos(around);
    const sa = Math.sin(around);
    const up: [number, number, number] = [
      Math.sin(lean) * ca, Math.cos(lean), Math.sin(lean) * sa,
    ];
    const across: [number, number, number] = [-sa, 0, ca];
    // Out of the face of the leaflet: across × up.
    const face: [number, number, number] = [
      across[1] * up[2] - across[2] * up[1],
      across[2] * up[0] - across[0] * up[2],
      across[0] * up[1] - across[1] * up[0],
    ];

    const first = positions.length / 3;
    for (let row = 0; row < rows; row++) {
      const t = row / plant.segments;
      const half = widthAt(plant, t) * 0.5;
      // The leaflet occupies the height above the stem.
      const height = stem + (1 - stem) * t;
      for (const side of [-1, 1]) {
        positions.push(
          up[0] * height + across[0] * side * half,
          up[1] * height + across[1] * side * half,
          up[2] * height + across[2] * side * half,
        );
        uvs.push(side > 0 ? 1 : 0, height);
        // <b>Rounded normals.</b> Fanned across the leaflet's width so a flat
        // strip shades like a cylinder, then rotated into the leaflet's own
        // frame. This is the cheapest thing in the Tsushima talk and the most
        // visible, and doing it here rather than in a shader costs a buffer
        // instead of instructions.
        // <b>Never let a leaf face the ground.</b> A leaflet tilted out past
        // horizontal has a face vector pointing under itself, and a normal
        // pointing down under a midday sun is black — which is what a clover
        // was: a pale shape with a hole punched in it. Clamping the vertical
        // component is not enough, because normalising undoes the clamp; the
        // normal has to be *blended* toward straight up, hard, for anything
        // with leaflets splayed out from a stem.
        //
        // <p>It is also the truer model. A leaf is thin and scatters from both
        // faces, so it does not go dark when it turns away — the flat lambert
        // a mesh normal implies is the wrong physics for foliage, and this
        // errs in the direction the real thing errs.
        const bias = plant.leaflets > 1 ? 0.62 : 0.15;
        const fx = across[0] * side * 0.8 + up[0] * 0.3 + face[0];
        const fy = across[1] * side * 0.8 + up[1] * 0.3 + face[1];
        const fz = across[2] * side * 0.8 + up[2] * 0.3 + face[2];
        const flat = Math.hypot(fx, fy, fz) || 1;
        const nx = (fx / flat) * (1 - bias);
        const ny = (fy / flat) * (1 - bias) + bias;
        const nz = (fz / flat) * (1 - bias);
        const length = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / length, ny / length, nz / length);
      }
    }
    for (let row = 0; row < plant.segments; row++) {
      const a = first + row * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    // A stem, where the leaflets stand off the ground on one.
    if (stem > 0.02 && leaflet === 0) {
      const start = positions.length / 3;
      const thin = plant.wide * 0.12;
      for (const height of [0, stem]) {
        for (const side of [-1, 1]) {
          positions.push(side * thin, height, 0);
          uvs.push(side > 0 ? 1 : 0, height);
          // Biased up for the same reason as the leaves above.
          normals.push(side * 0.42, 0.62, 0.56);
        }
      }
      indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
    }
  }

  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  return data;
}

/**
 * How wide the plant is a given fraction of the way up, as a fraction of its
 * own width.
 *
 * <p>One curve covers every shape in the table. `leaf` below one puts the
 * widest point low and runs out to a long point, which is a blade; above one
 * it rounds into a leaf. `head` adds a swelling near the top for a seed head,
 * which is the one thing a single profile cannot do on its own.
 */
export function widthAt(plant: Plant, t: number): number {
  const body = Math.sin(Math.PI * Math.pow(Math.max(0, Math.min(1, t)), plant.leaf));
  const thinning = 1 - t * plant.taper;
  const swelling = plant.head * Math.exp(-((t - 0.84) * (t - 0.84)) / 0.006);
  return Math.max(0, body * thinning + swelling);
}

/** Triangles in one plant, for the sidebar to be honest about cost. */
export function plantTriangles(plant: Plant): number {
  return plant.leaflets * plant.segments * 2 + (plant.stem > 0.02 ? 2 : 0);
}
