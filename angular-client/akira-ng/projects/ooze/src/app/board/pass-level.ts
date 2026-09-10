import { BattleMap, MapCell, TerrainKind } from './board.models';

/**
 * A pass between two mountains, in winter.
 *
 * <p>Two walls of rock and a floor of snow between them, running north to
 * south. The map is a corridor, which is the point of a pass: there is one way
 * through and everything above you is looking down at it.
 *
 * <p><b>Snow is the hardest thing on this board to light.</b> It is nearly
 * white and nearly featureless, so everything that makes it read as snow rather
 * than as paper is the shading of its own shape — which is why the floor here
 * is given more relief than any other map, in drifts across the line of the
 * pass, and why the sun sits low.
 */

export const PASS_NAME = 'The pass, midwinter';

export const PASS_WIDTH = 40;
export const PASS_HEIGHT = 40;

const CELL = 10;

/** Where the middle of the floor lies, in cells, at a given distance along. */
function floorAt(y: number): number {
  return PASS_WIDTH / 2 + Math.sin(y * 0.09) * 4.2 + Math.sin(y * 0.21 + 1.4) * 1.8;
}

/** How wide the walkable floor is, in cells either side of the middle. */
function widthAt(y: number): number {
  // It narrows and opens. The narrow places are where an ambush goes and the
  // open ones are where a fight has room, and a pass of one width is a corridor
  // in a dungeon rather than a place in mountains.
  return 4.4 + Math.sin(y * 0.13 + 0.6) * 1.9 + Math.sin(y * 0.33) * 0.8;
}

/**
 * The height of the ground, in feet.
 *
 * <p>Flat along the floor and then up hard. Raised to a power well above one so
 * the walls are concave — steepening as they go, which is what a glaciated
 * valley looks like and what makes the floor feel like a floor rather than the
 * bottom of a bowl.
 */
function heightAt(x: number, y: number): number {
  const middle = floorAt(y);
  const half = widthAt(y);
  const out = Math.abs(x - middle) - half;
  // Drifts. Long, low and across the pass, because that is the way the wind
  // comes down it.
  const drift = Math.sin(x * 0.28 + y * 0.09) * 2.6 + Math.sin(y * 0.55) * 1.4;
  if (out <= 0) {
    return 4 + drift;
  }
  return 4 + drift + Math.pow(out, 1.75) * 5.2;
}

export function buildPass(): MapCell[] {
  const cells: MapCell[] = [];
  for (let x = 0; x < PASS_WIDTH; x++) {
    for (let y = 0; y < PASS_HEIGHT; y++) {
      const out = Math.abs(x - floorAt(y)) - widthAt(y);
      // Deep snow on the floor, scoured snow on the lower slopes, bare rock
      // where it is too steep for anything to lie.
      const kind: TerrainKind = out <= 0 ? 'GRASS' : out < 2.4 ? 'RUBBLE' : 'ROAD';
      cells.push({
        x, y,
        elevationFeet: Math.round(heightAt(x, y)),
        terrain: kind,
        light: null,
        cover: null,
        opaque: null,
        // Deep snow is Difficult Terrain, which is the one rule this map is
        // really about — it halves everyone's movement in the one place there
        // is to stand.
        extraMoveCostFeet: kind === 'GRASS' ? 5 : null,
        notes: null,
      });
    }
  }
  return cells;
}

export function passMap(): Omit<BattleMap, 'id'> {
  return {
    width: PASS_WIDTH,
    height: PASS_HEIGHT,
    cellFeet: 5,
    defaultTerrain: 'GRASS',
    defaultLight: 'BRIGHT',
    cells: buildPass(),
    props: [],
  };
}

export function at(cellX: number, cellY: number): { x: number; y: number; z: number } {
  return {
    x: cellX * CELL + CELL / 2,
    y: cellY * CELL + CELL / 2,
    z: heightAt(cellX, cellY) * 2,
  };
}

/** The middle of the floor at a given distance along, in half-feet. */
export function floorMiddle(cellY: number): { x: number; y: number; z: number } {
  return at(Math.round(floorAt(cellY)), cellY);
}
