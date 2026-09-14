import { describe, expect, it } from 'vitest';
import { MAX_PLANTS, grassLattice } from './meadow';
import { type Plant, MEADOW } from './species';

const EAST = 440;
const NORTH = 300;
const AREA = EAST * NORTH;

function sow(plants: readonly Plant[]) {
  return grassLattice(plants, EAST, NORTH);
}

function by(plants: readonly Plant[], id: string) {
  const found = sow(plants).sowings.find(sowing => sowing.plant.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

describe('grassLattice', () => {

  it('gives every species the density its table asks for', () => {
    const { lattice, sowings } = sow(MEADOW);
    expect(lattice.fit).toBe(1);
    for (const { plant, slots, keep } of sowings) {
      const perArea = (slots * keep) / (lattice.pitch * lattice.pitch);
      expect(perArea, plant.id).toBeCloseTo(plant.perArea, 5);
    }
  });

  it('leaves the other species alone when one is removed', () => {
    const without = MEADOW.filter(plant => plant.id !== 'clover');
    for (const plant of without) {
      expect(by(without, plant.id), plant.id).toEqual(by(MEADOW, plant.id));
    }
  });

  it('leaves the other species alone when one is added', () => {
    const extra: Plant = { ...MEADOW[3], id: 'extra', perArea: 0.3 };
    const more = [...MEADOW, extra];
    for (const plant of MEADOW) {
      expect(by(more, plant.id), plant.id).toEqual(by(MEADOW, plant.id));
    }
  });

  it('sizes the cell from the densest species, not the rarest', () => {
    const rarer = MEADOW.map(plant => plant.id === 'seed'
      ? { ...plant, perArea: plant.perArea / 100 } : plant);
    expect(sow(rarer).lattice.pitch).toBeCloseTo(sow(MEADOW).lattice.pitch, 10);
  });

  it('holds the mix when the ceiling bites', () => {
    const greedy = MEADOW.map(plant => ({ ...plant, perArea: plant.perArea * 8 }));
    const { lattice, sowings } = sow(greedy);
    expect(lattice.fit).toBeLessThan(1);
    const asked = greedy.reduce((sum, plant) => sum + plant.perArea * plant.crowd, 0) * AREA;
    expect(lattice.fit).toBeCloseTo(MAX_PLANTS / asked, 10);
    for (const { plant, slots, keep } of sowings) {
      const perArea = (slots * keep) / (lattice.pitch * lattice.pitch);
      expect(perArea, plant.id).toBeCloseTo(plant.perArea * lattice.fit, 5);
    }
  });

  it('never reserves fewer slots than a species can fill', () => {
    for (const { plant, keep } of sow(MEADOW).sowings) {
      expect(keep, plant.id).toBeGreaterThan(0);
      expect(keep, plant.id).toBeLessThanOrEqual(1);
    }
  });

  it('leaves room for a species to reach its crowd without saturating', () => {
    for (const { plant, keep } of sow(MEADOW).sowings) {
      expect(keep * plant.crowd, plant.id).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('holds the mix at every density', () => {
    const { lattice, sowings } = sow(MEADOW);
    for (const density of [1, 0.5, 0.25, 0.1]) {
      for (const { plant, slots, keep } of sowings) {
        expect(keep * density * plant.crowd, `${plant.id} at ${density}`)
          .toBeLessThanOrEqual(1 + 1e-9);
        const perArea = (slots * keep * density) / (lattice.pitch * lattice.pitch);
        expect(perArea, `${plant.id} at ${density}`)
          .toBeCloseTo(plant.perArea * density, 5);
      }
    }
  });
});
