import { BattleMap, MapCell, TerrainKind } from './board.models';

/**
 * A road through open country, early 1700s, somewhere in the Virginia piedmont.
 *
 * <p>One o'clock on a summer afternoon. The road is not built — nobody paved
 * anything out here — it is the line where enough carts, horses and boots have
 * been that the grass gave up. So it is drawn as *wear* rather than as a
 * surface: the middle is bare, the edges are thin and struggling, and the
 * meadow either side is untouched.
 *
 * <p>It wanders, because a track made by traffic follows the ground and the
 * ground is never straight, and it is wider where the going is soft and carts
 * have swung wide to avoid a wet patch. The wet patches are where it drains
 * badly, which is where the wheels have cut deepest, which is why they are wet.
 * That circle is the whole of what makes a dirt road look real.
 */

export const ROAD_NAME = 'The Fredericksburg road, midsummer';

/** Cells across and along. 44 by 30 at five feet is 220 by 150 feet of country. */
export const ROAD_WIDTH = 44;
export const ROAD_HEIGHT = 30;

const CELL = 10;

/**
 * Where the middle of the road is, in cells, for a given distance along it.
 *
 * <p>Two slow sines at unrelated periods. Not noise: a cart track bends around
 * things, so its curvature is long and smooth, and noise would give it the
 * jitter of a footpath rather than the sweep of a road.
 */
function centreAt(x: number): number {
  return ROAD_HEIGHT / 2
    + Math.sin(x * 0.13) * 3.1
    + Math.sin(x * 0.31 + 1.2) * 1.15;
}

/**
 * How wide the bare part is at a given point along, in cells.
 *
 * <p>Wider where it is boggy — carts pull out around a soft spot and the
 * pulling out is what widens it.
 */
function widthAt(x: number): number {
  // Half-widths in cells, so the bare part runs about eleven to sixteen feet —
  // a cart is five, and two of them pass with difficulty, which is what a road
  // like this was. The first pass at this was twice as wide and read as a
  // riverbed.
  return 1.15 + Math.sin(x * 0.21 + 0.6) * 0.32 + Math.sin(x * 0.07) * 0.25;
}

/** The soft, badly drained stretches, in cells along. */
const BOGGY: readonly (readonly [number, number])[] = [
  [9, 13],
  [24, 27],
  [35, 38],
];

function isBoggy(x: number): boolean {
  return BOGGY.some(([from, to]) => x >= from && x <= to);
}

/**
 * The level, as sparse cells.
 *
 * <p>Grass is the map's default, so only the road is stored — which is both
 * how the server wants it and a fair description of the place: the country is
 * the country, and the road is the exception somebody wore into it.
 */
export function buildRoad(): MapCell[] {
  const cells: MapCell[] = [];
  for (let x = 0; x < ROAD_WIDTH; x++) {
    const centre = centreAt(x);
    const half = widthAt(x);
    const boggy = isBoggy(x);
    for (let y = 0; y < ROAD_HEIGHT; y++) {
      const offset = Math.abs(y - centre);
      if (offset > half + 0.9) {
        continue;
      }
      // The middle is bare and the shoulder is trodden but not dead. Rubble is
      // the closest the engine has to "worn", and it costs nothing extra to
      // cross, which is right — a verge is not difficult ground.
      const kind: TerrainKind = offset <= half
        ? (boggy && offset <= half * 0.72 ? 'MUD' : 'ROAD')
        : 'RUBBLE';
      cells.push({
        x, y,
        elevationFeet: null,
        terrain: kind,
        light: null,
        cover: null,
        opaque: null,
        // Mud is Difficult Terrain and the rest of a road emphatically is not —
        // a road is the one part of open country that is *easier* to cross.
        extraMoveCostFeet: kind === 'MUD' ? 5 : null,
        notes: null,
      });
    }
  }
  return cells;
}

/** The map, ready either to draw or to POST. */
export function roadMap(): Omit<BattleMap, 'id'> {
  return {
    width: ROAD_WIDTH,
    height: ROAD_HEIGHT,
    cellFeet: 5,
    defaultTerrain: 'GRASS',
    // One in the afternoon in July. There is nothing here that is not lit.
    defaultLight: 'BRIGHT',
    cells: buildRoad(),
    props: [],
  };
}

/** Half-feet from a cell index, for placing anything on this map. */
export function at(cellX: number, cellY: number): { x: number; y: number } {
  return { x: cellX * CELL + CELL / 2, y: cellY * CELL + CELL / 2 };
}
