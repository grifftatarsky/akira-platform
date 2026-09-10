import { BoardScene, TerrainTile } from './board.models';
import { ScatterKind, scatter } from './scatter';

/**
 * What ends up lying on the ground.
 *
 * <p>Worth asserting rather than eyeballing, because the claim is about a
 * *distribution* and a screenshot only ever shows one draw of it. "Stones are
 * commonest where the turf has gone" is a statement about hundreds of
 * placements, and the eye is a poor instrument for that even when the answer is
 * plainly wrong.
 */
describe('scatter', () => {

  function board(kind: TerrainTile['kind'], cells = 20): BoardScene {
    const tiles: TerrainTile[] = [];
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        tiles.push({
          x: x * 10 + 5, y: y * 10 + 5, size: 10, base: 0, height: 0,
          kind, light: 'BRIGHT', opaque: false, cover: 'NONE', rotation: 0,
          colour: 0, baseColour: 0,
        });
      }
    }
    return {
      tiles, tokens: [], props: [],
      widthHalfFeet: cells * 10, heightHalfFeet: cells * 10,
    };
  }

  const count = (scene: BoardScene, kind: ScatterKind) =>
    scatter(scene).filter(s => s.kind === kind).length;

  it('grows grass on grass and not on the road', () => {
    expect(count(board('GRASS'), 'GRASS_TUFT')).toBeGreaterThan(20);
    expect(count(board('ROAD'), 'GRASS_TUFT')).toBe(0);
  });

  it('leaves stones where the turf has gone, and not under it', () => {
    // The road is what strips the grass, so it is where stones surface.
    expect(count(board('ROAD'), 'STONE')).toBeGreaterThan(20);
    expect(count(board('GRASS'), 'STONE')).toBe(0);
  });

  it('drops nothing into standing mud', () => {
    // Wet ground is still bare ground, so the stone rule would otherwise put a
    // field of rocks in every puddle.
    expect(scatter(board('MUD'))).toHaveLength(0);
  });

  it('places the same board the same way every time', () => {
    // Deterministic on purpose: a meadow that reshuffled on every render would
    // be a distraction, and it would make every screenshot of a bug
    // impossible to reproduce.
    const once = scatter(board('GRASS'));
    const twice = scatter(board('GRASS'));

    expect(twice).toEqual(once);
  });

  it('varies size and facing rather than stamping one shape', () => {
    const placed = scatter(board('GRASS'));

    expect(new Set(placed.map(s => s.turn)).size).toBeGreaterThan(placed.length / 2);
    expect(Math.max(...placed.map(s => s.scale)))
      .toBeGreaterThan(Math.min(...placed.map(s => s.scale)) * 1.4);
  });

  it('scatters off the lattice it walks, not on it', () => {
    // The candidates are a grid; the placements must not be, or the meadow
    // comes out in rows — which is the whole thing the ground work exists to
    // avoid.
    const xs = scatter(board('GRASS')).map(s => s.x % 7);

    expect(new Set(xs.map(x => Math.round(x))).size).toBeGreaterThan(3);
  });
});
