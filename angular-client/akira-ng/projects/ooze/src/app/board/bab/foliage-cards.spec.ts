import { cardGeometry, type Cut, type FoliageSheet } from './foliage-cards';
import { MEADOW, type CardSpec, type Plant } from './species';

describe('card geometry', () => {

  const DISC: readonly (readonly [number, number])[] = [
    [0.45, 0.55], [0.30, 0.70], [0.15, 0.85], [0.05, 0.95], [0.00, 1.00],
    [0.00, 1.00], [0.02, 0.98], [0.08, 0.92], [0.18, 0.82], [0.30, 0.70],
    [0.40, 0.60], [0.46, 0.54], [0.49, 0.51],
  ];

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
      id: 'test', name: 'Test', note: '', perArea: 1,
      tall: 1, wide: 0.5, head: 0, segments: 3,
      widest: 0.5, fullness: 1, blunt: 0.1, notch: 0, fold: 0,
      leaflets: 1, spread: 0, stem: 0, petals: 0, spikelets: 0,
      droop: 0, stiff: 1,
      base: [0, 0, 0], tip: [0, 0, 0], bloom: [0, 0, 0], blooms: false,
      veins: 0, sweep: 0, lit: 1, patch: 0, clumping: 1, crowd: 1,
      cards, stemTall, damp: 0,
    };
  }

  function points(data: { positions?: number[] | Float32Array }): [number, number, number][] {
    const out: [number, number, number][] = [];
    const p = data.positions ?? [];
    for (let at = 0; at < p.length; at += 3) {
      out.push([p[at], p[at + 1], p[at + 2]]);
    }
    return out;
  }

  describe('a card contains the picture it carries', () => {

    it('is at least as wide as the widest point in every row band', () => {
      const one = cut(DISC);
      for (const rows of [1, 2, 3, 5, 8]) {
        const data = cardGeometry(
          plant([card({ rows })]), sheet({ leaf: [one] }),
        );
        const all = points(data);

        const widest = Math.max(...all.map(([x]) => Math.abs(x)));

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

      const wide = (row: number) => Math.max(
        Math.abs(all[row * 2][0]), Math.abs(all[row * 2 + 1][0]),
      );

      expect(wide(0)).toBeLessThan(wide(rows / 2) * 0.65);
    });
  });

  describe('trimming the photographed stalk', () => {

    it('starts the card at the recorded junction, not at the cut-out root', () => {
      const one = cut(STALKED, 0.4);
      const data = cardGeometry(
        plant([card({ rows: 6, trimStalk: true })]), sheet({ leaf: [one] }),
      );
      const vs = (data.uvs ?? []).filter((_, at) => at % 2 === 1);

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
