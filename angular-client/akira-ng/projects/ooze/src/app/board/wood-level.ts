import { BattleMap, MapCell, TerrainKind } from './board.models';

/**
 * A cabin in the woods, late afternoon.
 *
 * <p>The whole map is one idea: a clearing somebody made. Everything else
 * follows from it — the trees stop because they were felled, the floor changes
 * because the needles stop falling, the path exists because whoever lives here
 * walks out, and the ground is churned at the door because that is where they
 * stand.
 *
 * <p><b>The trees are not placed.</b> They grow where the ground is untouched,
 * which is a rule about wear and not a list of positions — so clearing the
 * trees is done by wearing the ground, and the edge of the clearing is ragged
 * for the same reason the edge of the road on the meadow board is: the field
 * that decides it is noisy, and boundaries in a wood are not lines.
 */

export const WOOD_NAME = 'The cabin, late afternoon';

export const WOOD_WIDTH = 44;
export const WOOD_HEIGHT = 32;

const CELL = 10;

/** Where the cabin stands, in cells. */
export const CABIN_X = 28;
export const CABIN_Y = 15;

/** How far the clearing reaches from the cabin, in cells. */
function clearingAt(angle: number): number {
  // Not a circle. A clearing is however far somebody could be bothered to
  // carry a felled tree, which is further along the path than behind the house.
  return 7.2 + Math.sin(angle * 2 + 0.7) * 1.7 + Math.sin(angle * 3 - 1.1) * 1.1;
}

/** The path in, as a line of cells across the map. */
function pathAt(x: number): number {
  return CABIN_Y + Math.sin(x * 0.17) * 2.6 + Math.sin(x * 0.41 + 0.8) * 1.1;
}

/**
 * Rolling ground, in feet. Gentle — a wood on a hillside would hide the cabin,
 * and the cabin is what the map is of.
 */
function heightAt(x: number, y: number): number {
  return 6
    + Math.sin(x * 0.11) * 4.5
    + Math.sin(y * 0.14 + 1.3) * 3.2
    + Math.sin((x + y) * 0.07) * 2.4;
}

export function buildWood(): MapCell[] {
  const cells: MapCell[] = [];
  for (let x = 0; x < WOOD_WIDTH; x++) {
    const path = pathAt(x);
    for (let y = 0; y < WOOD_HEIGHT; y++) {
      const dx = x - CABIN_X;
      const dy = y - CABIN_Y;
      const away = Math.hypot(dx, dy);
      const open = away < clearingAt(Math.atan2(dy, dx));
      // The path only runs as far as the clearing; inside it, everywhere is
      // trodden.
      const onPath = x < CABIN_X && Math.abs(y - path) < 0.9;

      let kind: TerrainKind | null = null;
      if (onPath || (open && away < 2.6)) {
        // Bare earth: the path, and the ground at the door.
        kind = 'ROAD';
      } else if (open) {
        // Cleared but not walked — grass and leaf litter, and no trees.
        kind = 'RUBBLE';
      }
      if (!kind) {
        continue;
      }
      cells.push({
        x, y,
        elevationFeet: Math.round(heightAt(x, y)),
        terrain: kind,
        light: null,
        cover: null,
        opaque: null,
        extraMoveCostFeet: null,
        notes: null,
      });
    }
  }
  return cells;
}

export function woodMap(): Omit<BattleMap, 'id'> {
  return {
    width: WOOD_WIDTH,
    height: WOOD_HEIGHT,
    cellFeet: 5,
    defaultTerrain: 'GRASS',
    // Under a canopy in the late afternoon. Dim rather than bright, which is
    // a rules fact as much as a lighting one: ranged attacks into a wood are
    // harder, and the map should say so.
    defaultLight: 'BRIGHT',
    cells: buildWood(),
    props: [],
  };
}

/** Where the cabin stands, in half-feet. */
export function cabinPosition(): { x: number; y: number; z: number } {
  return at(CABIN_X, CABIN_Y);
}

export function at(cellX: number, cellY: number): { x: number; y: number; z: number } {
  return {
    x: cellX * CELL + CELL / 2,
    y: cellY * CELL + CELL / 2,
    z: heightAt(cellX, cellY) * 2,
  };
}
