import { cardGeometry, type Cut, type FoliageSheet } from './foliage-cards';
import { MEADOW, type CardSpec, type Plant } from './species';

/**
 * The shapes the meadow is built out of, checked as arithmetic.
 *
 * <p><b>Every foliage bug this renderer has had was a geometry bug that looked
 * like a texture bug.</b> The oxeye daisy rendered as a white cigarette and the
 * cut-out on the sheet was a perfect photographed flower; the clover had two
 * stems and the scan has one. In both cases the picture was right and the mesh
 * carrying it was wrong, and in both cases it took several rounds of looking at
 * screenshots to work out which. These assert the mesh directly.
 *
 * <p>No GPU is involved and none is needed — `cardGeometry` is a pure function
 * from a plant and a cut-out table to vertex data, which is the whole reason it
 * is worth keeping pure.
 */
describe('card geometry', () => {

  /** A silhouette that is narrow at both ends and widest in the middle. */
  const DISC: readonly (readonly [number, number])[] = [
    [0.45, 0.55], [0.30, 0.70], [0.15, 0.85], [0.05, 0.95], [0.00, 1.00],
    [0.00, 1.00], [0.02, 0.98], [0.08, 0.92], [0.18, 0.82], [0.30, 0.70],
    [0.40, 0.60], [0.46, 0.54], [0.49, 0.51],
  ];

  /** A stalk at the bottom, then a leaf: what a clover scan looks like. */
  const STALKED: readonly (readonly [number, number])[] = [
    [0.48, 0.52], [0.48, 0.52], [0.47, 0.53], [0.20, 0.80], [0.02, 0.98],
    [0.00, 1.00], [0.00, 1.00], [0.03, 0.97], [0.10, 0.90], [0.22, 0.78],
    [0.34, 0.66], [0.44, 0.56], [0.49, 0.51],
  ];

  function cut(spans: readonly (readonly [number, number])[], stalk?: number): Cut {
    return { u0: 0.2, v0: 0.1, u1: 0.6, v1: 0.5, aspect: 1, spans, stalk };
  }

  function sheet(cuts: Record<string, Cut[]>): FoliageSheet {
    return { texture: null as never, groups: cuts };
  }

  function card(over: Partial<CardSpec> = {}): CardSpec {
    return {
      group: 'leaf', count: 1, tall: 1, at: 0, out: 0, lean: 0, rows: 2,
      taper: 1, ...over,
    };
  }

  function plant(cards: CardSpec[], stemTall = 0): Plant {
    return {
      id: 'test', name: 'Test', note: '', share: 1,
      tall: 1, wide: 0.5, head: 0, segments: 3,
      widest: 0.5, fullness: 1, blunt: 0.1, notch: 0, fold: 0,
      leaflets: 1, spread: 0, stem: 0, petals: 0, spikelets: 0,
      droop: 0, stiff: 1,
      base: [0, 0, 0], tip: [0, 0, 0], bloom: [0, 0, 0], blooms: false,
      veins: 0, sweep: 0, lit: 1, patch: 0, clumping: 1, crowd: 1,
      cards, stemTall, wearMax: 1, damp: 0,
    };
  }

  /** Every vertex of the built mesh, as triples. */
  function points(data: { positions?: number[] | Float32Array }): [number, number, number][] {
    const out: [number, number, number][] = [];
    const p = data.positions ?? [];
    for (let at = 0; at < p.length; at += 3) {
      out.push([p[at], p[at + 1], p[at + 2]]);
    }
    return out;
  }

  describe('a card contains the picture it carries', () => {

    /**
     * <b>The daisy cigarette.</b> A card is a quad strip fitted to the
     * silhouette, and fitting it to a *point sample* per row clips anything
     * that bulges between the samples. With two rows and a disc-shaped
     * outline — narrow, wide, narrow — the quad came out 45% of the flower's
     * width and the mesh cut the petals off before the alpha test could see
     * them.
     */
    it('is at least as wide as the widest point in every row band', () => {
      const one = cut(DISC);
      for (const rows of [1, 2, 3, 5, 8]) {
        const data = cardGeometry(
          plant([card({ rows })]), sheet({ leaf: [one] }),
        );
        const all = points(data);
        // The card lies in the x/y plane at lean 0, so |x| is its half-width.
        const widest = Math.max(...all.map(([x]) => Math.abs(x)));
        // The silhouette's own widest, as a half-width of the card.
        const outermost = Math.max(...DISC.map(
          ([from, to]) => Math.max(Math.abs(from - 0.5), Math.abs(to - 0.5)),
        ));
        expect(widest).toBeGreaterThanOrEqual(outermost - 1e-6);
      }
    });

    it('narrows where the silhouette narrows', () => {
      const rows = 8;
      const data = cardGeometry(
        plant([card({ rows })]), sheet({ leaf: [cut(DISC)] }),
      );
      const all = points(data);
      // Two vertices a row, in order from the root, so the band is picked by
      // index rather than by height — the card's own size jitter means a
      // height window can miss every row and take the maximum of nothing.
      const wide = (row: number) => Math.max(
        Math.abs(all[row * 2][0]), Math.abs(all[row * 2 + 1][0]),
      );
      // A disc is a fraction of its width at the root and all of it halfway up.
      expect(wide(0)).toBeLessThan(wide(rows / 2) * 0.65);
    });
  });

  describe('trimming the photographed stalk', () => {

    /**
     * <b>The clover's second stem.</b> The scan is a trefoil on its own
     * petiole, so a card carrying the whole of it cannot lie flat without its
     * stalk lying flat too. Trimming means the card starts at the junction —
     * and the junction is measured off the sheet's alpha by
     * `tools/foliage-trim.mjs`, because it cannot be read from the outline:
     * the petiole runs up the middle *between* the leaflets, so the cut is at
     * full width while the stalk still has half its length to go.
     */
    it('starts the card at the recorded junction, not at the cut-out root', () => {
      const one = cut(STALKED, 0.4);
      const data = cardGeometry(
        plant([card({ rows: 6, trimStalk: true })]), sheet({ leaf: [one] }),
      );
      const vs = (data.uvs ?? []).filter((_, at) => at % 2 === 1);
      // v runs from v1 at the root to v0 at the tip, and v0 < v1 here.
      const lowest = Math.max(...vs);
      const junction = one.v1 + (one.v0 - one.v1) * 0.4;
      expect(lowest).toBeCloseTo(junction, 5);
    });

    it('leaves the card whole when nothing is trimmed', () => {
      const one = cut(STALKED, 0.4);
      const data = cardGeometry(
        plant([card({ rows: 6 })]), sheet({ leaf: [one] }),
      );
      const vs = (data.uvs ?? []).filter((_, at) => at % 2 === 1);
      expect(Math.max(...vs)).toBeCloseTo(one.v1, 5);
    });

    it('ignores a junction the sheet never recorded', () => {
      const one = cut(STALKED);
      const data = cardGeometry(
        plant([card({ rows: 4, trimStalk: true })]), sheet({ leaf: [one] }),
      );
      const vs = (data.uvs ?? []).filter((_, at) => at % 2 === 1);
      expect(Math.max(...vs)).toBeCloseTo(one.v1, 5);
    });
  });

  describe('a flower head is a disc on the stem', () => {

    const HEAD = card({ group: 'head', tall: 0.8, at: 2, lean: 0, disc: 9 });

    it('puts its middle on the stem, not its bottom edge', () => {
      const data = cardGeometry(
        plant([HEAD], 2), sheet({ head: [cut(DISC)], blade: [cut(DISC)] }),
      );
      const all = points(data);
      // The first vertex of a head is its centre, by construction.
      const [x, y, z] = all[0];
      expect(Math.hypot(x, z)).toBeLessThan(1e-6);
      expect(y).toBeCloseTo(2, 6);
    });

    it('is a circle of the radius it was asked for', () => {
      const data = cardGeometry(
        plant([HEAD]), sheet({ head: [cut(DISC)] }),
      );
      const all = points(data);
      const centre = all[0];
      const rim = all.slice(1);
      const radius = HEAD.tall * 0.5;
      const dish = radius * 0.22;
      for (const at of rim) {
        const span = Math.hypot(
          at[0] - centre[0], at[1] - centre[1], at[2] - centre[2],
        );
        // Every rim point is the radius out and the dish up, so its distance
        // from the centre is the hypotenuse of the two.
        expect(span).toBeCloseTo(Math.hypot(radius, dish), 5);
      }
    });

    it('closes its ring: first and last rim points meet', () => {
      const data = cardGeometry(plant([HEAD]), sheet({ head: [cut(DISC)] }));
      const all = points(data);
      const first = all[1];
      const last = all[all.length - 1];
      expect(Math.hypot(
        first[0] - last[0], first[1] - last[1], first[2] - last[2],
      )).toBeLessThan(1e-6);
    });

    it('is dished, not flat: the rim stands off the centre plane', () => {
      const data = cardGeometry(plant([HEAD]), sheet({ head: [cut(DISC)] }));
      const all = points(data);
      const centre = all[0];
      const rim = all.slice(1);
      // At lean 0 the disc stands upright, so the dish displaces along z.
      const offsets = rim.map(at => Math.abs(at[2] - centre[2]));
      expect(Math.min(...offsets)).toBeGreaterThan(1e-6);
    });

    it('draws one triangle a segment', () => {
      for (const disc of [3, 6, 9, 16]) {
        const data = cardGeometry(
          plant([card({ group: 'head', tall: 0.8, at: 2, lean: 0, disc })]),
          sheet({ head: [cut(DISC)] }),
        );
        expect((data.indices ?? []).length / 3).toBe(disc);
      }
    });

    it('samples the circle inscribed in its cut-out', () => {
      const one = cut(DISC);
      const data = cardGeometry(plant([HEAD]), sheet({ head: [one] }));
      const uvs = data.uvs ?? [];
      for (let at = 0; at < uvs.length; at += 2) {
        expect(uvs[at]).toBeGreaterThanOrEqual(Math.min(one.u0, one.u1) - 1e-6);
        expect(uvs[at]).toBeLessThanOrEqual(Math.max(one.u0, one.u1) + 1e-6);
        expect(uvs[at + 1]).toBeGreaterThanOrEqual(Math.min(one.v0, one.v1) - 1e-6);
        expect(uvs[at + 1]).toBeLessThanOrEqual(Math.max(one.v0, one.v1) + 1e-6);
      }
    });
  });

  describe('every plant the board actually sows', () => {

    const REAL = sheet({
      leaf: [cut(DISC)], head: [cut(DISC)], blade: [cut(DISC)],
      spray: [cut(DISC)], daisy: [cut(DISC)], clover: [cut(STALKED, 0.4)],
      rosette: [cut(DISC)],
    });

    it.each(MEADOW.map(one => [one.id, one] as const))(
      '%s builds a finite mesh with unit normals', (_id, one) => {
        const data = cardGeometry(one, REAL);
        const positions = data.positions ?? [];
        const normals = data.normals ?? [];
        expect(positions.length).toBeGreaterThan(0);
        expect(normals.length).toBe(positions.length);
        for (const value of positions) {
          expect(Number.isFinite(value)).toBe(true);
        }
        for (let at = 0; at < normals.length; at += 3) {
          const length = Math.hypot(normals[at], normals[at + 1], normals[at + 2]);
          expect(length).toBeCloseTo(1, 5);
        }
      });

    it.each(MEADOW.map(one => [one.id, one] as const))(
      '%s never points a normal below the horizon', (_id, one) => {
        const data = cardGeometry(one, REAL);
        const normals = data.normals ?? [];
        for (let at = 1; at < normals.length; at += 3) {
          // A leaf is thin and scatters from both faces; a normal under the
          // horizon takes the hemisphere's ground colour and reads as black.
          expect(normals[at]).toBeGreaterThan(-1e-6);
        }
      });

    it.each(MEADOW.map(one => [one.id, one] as const))(
      '%s indexes only vertices it built', (_id, one) => {
        const data = cardGeometry(one, REAL);
        const count = (data.positions ?? []).length / 3;
        for (const index of data.indices ?? []) {
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(count);
        }
      });

    it.each(MEADOW.map(one => [one.id, one] as const))(
      '%s stands on the ground and no lower', (_id, one) => {
        const data = cardGeometry(one, REAL);
        const lowest = Math.min(...points(data).map(([, y]) => y));
        expect(lowest).toBeGreaterThan(-0.001);
      });
  });
});
