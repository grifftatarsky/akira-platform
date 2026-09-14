import { BattleMap, MapCell, TerrainKind } from './board.models';

/**
 * A headland above the sea, with a ruined light on it.
 *
 * <p>The sea is west and the land climbs out of it: a shelf of wet rock the
 * tide covers, then a cliff, then turf. Everything about the shape is the
 * cliff — it is what makes the light visible from a mile out, what makes the
 * stair worth cutting, and what a party has to get up.
 *
 * <p><b>Drawn as elevation, not as walls.</b> A cliff built out of wall squares
 * is a fence: it blocks and it has no top. Given as a hundred and ten feet of
 * height over four squares it is ground — the engine derives the slope, charges
 * for it, and the renderer bends its mesh over it — and the stair is simply the
 * one line up it that is not steep.
 */

export const COAST_NAME = 'The Broken Light, evening';

export const COAST_WIDTH = 48;
export const COAST_HEIGHT = 34;

const CELL = 10;

/** How far out the water comes, in cells, at a given distance along the shore. */
function shoreAt(y: number): number {
  return 8.5 + Math.sin(y * 0.29) * 1.9 + Math.sin(y * 0.11 + 2.1) * 1.2;
}

/** The stair runs up the cliff on this line, and is two cells wide. */
const STAIR_Y = 17;

/** How high the headland stands above the water, in feet. */
const CLIFF = 110;

/**
 * The height of the land at a cell, in feet above the water line.
 *
 * <p>A profile rather than a set of terraces: a shelf that is nearly flat, a
 * cliff that is nearly vertical, and a top that rolls inland. The cliff is
 * raised to a power so it is concave — undercut at the bottom and easing at the
 * top, which is what the sea does to rock and what stops it reading as a ramp.
 */
function heightAt(x: number, y: number): number {
  const shore = shoreAt(y);
  const inland = x - shore;
  if (inland < 0) {
    // Under water. Deepening away from the shore, so the shallows read shallow.
    return Math.max(-40, inland * 5);
  }
  if (inland < 3) {
    // The wave-cut shelf, barely above the water and awash at the far end.
    return inland * 1.6;
  }
  const up = Math.min(1, (inland - 3) / 4.6);
  const top = CLIFF + Math.sin(x * 0.17) * 5 + Math.sin(y * 0.23 + 1) * 4;
  return 4.8 + Math.pow(up, 1.8) * (top - 4.8);
}

/**
 * The stair: a cut that replaces the cliff on one line with something climbable.
 *
 * <p>Steep — a hundred and ten feet over sixteen squares is a stair somebody
 * would think twice about, which is the point — but not a cliff, and the engine
 * will tell a party exactly how much it costs because it derives that from the
 * height it is given.
 */
function stairHeight(x: number, y: number): number | null {
  if (Math.abs(y - STAIR_Y) > 1) {
    return null;
  }
  const shore = shoreAt(y);
  const from = shore + 2;
  const to = shore + 18;
  if (x < from || x > to) {
    return null;
  }
  const along = (x - from) / (to - from);
  // Landings: the run flattens every few steps, which is what a cut stair does
  // and what makes it read as built rather than as a slope somebody smoothed.
  const stepped = Math.floor(along * 9) / 9 * 0.72 + along * 0.28;
  return 3 + stepped * (heightAt(to, y) - 3);
}

export function buildCoast(): MapCell[] {
  const cells: MapCell[] = [];
  for (let x = 0; x < COAST_WIDTH; x++) {
    for (let y = 0; y < COAST_HEIGHT; y++) {
      const stair = stairHeight(x, y);
      const height = stair ?? heightAt(x, y);
      const shore = shoreAt(y);
      const inland = x - shore;

      let kind: TerrainKind;
      if (stair !== null) {
        kind = 'ROAD';
      } else if (inland < -2.5) {
        kind = 'DEEP_WATER';
      } else if (inland < 0.4) {
        kind = 'WATER';
      } else if (inland < 3) {
        // Wet rock. Bare, because nothing grows where the tide reaches.
        kind = 'ROAD';
      } else if (inland < 7.6) {
        // The cliff face: rock with whatever has taken hold in the cracks.
        kind = 'RUBBLE';
      } else {
        kind = 'GRASS';
      }

      cells.push({
        x, y,
        elevationFeet: Math.round(height),
        terrain: kind,
        light: null,
        cover: null,
        opaque: null,
        // Wet rock is treacherous and the stair is a stair. The cliff is not
        // given a cost because the engine works one out from the slope, which
        // is a better answer than a number typed here.
        extraMoveCostFeet: kind === 'ROAD' && stair === null && inland < 3 ? 5 : null,
        notes: null,
      });
    }
  }
  return cells;
}

export function coastMap(): Omit<BattleMap, 'id'> {
  return {
    width: COAST_WIDTH,
    height: COAST_HEIGHT,
    cellFeet: 5,
    defaultTerrain: 'GRASS',
    defaultLight: 'BRIGHT',
    cells: buildCoast(),
    props: [],
  };
}

/** Where the light stands, in half-feet, so the tower and the map agree. */
export function lightPosition(): { x: number; y: number; z: number } {
  const x = 39;
  const y = STAIR_Y;
  return {
    x: x * CELL + CELL / 2,
    y: y * CELL + CELL / 2,
    z: heightAt(x, y) * 2,
  };
}

/** Half-feet from a cell index, for placing anything on this map. */
export function at(cellX: number, cellY: number): { x: number; y: number; z: number } {
  return {
    x: cellX * CELL + CELL / 2,
    y: cellY * CELL + CELL / 2,
    z: (stairHeight(cellX, cellY) ?? heightAt(cellX, cellY)) * 2,
  };
}
