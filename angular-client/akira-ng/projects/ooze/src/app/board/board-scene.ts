import {
  Battle, BattleMap, BoardScene, Combatant, CoverDegree, Encounter, LightLevel, MapCell,
  Participant, TerrainKind, TerrainTile, TokenPlacement,
} from './board.models';

/**
 * Turning what the server sent into what the renderer draws.
 *
 * <p>Pure, and deliberately so. jsdom has no WebGL context, so anything asserted
 * inside a renderer cannot be tested at all — but every rule about what the
 * board *shows* lives here instead, and is provable in the same suite as the
 * rest of the app.
 *
 * <p>Nothing in this file names three. That is the hedge the renderer comparison
 * argued for: the scene is described as data, so swapping the renderer is a
 * rewrite of one adapter rather than of the board.
 */

/** How tall a wall stands, in half-feet. Eight feet reads as a wall from above and is one. */
export const WALL_HEIGHT = 16;

/** How far a token floats above its ground, so it never z-fights the floor. */
export const TOKEN_LIFT = 1;

const TERRAIN_COLOURS: Record<TerrainKind, number> = {
  FLOOR: 0x6b6558,
  RUBBLE: 0x7a7268,
  WATER: 0x2f6f8f,
  DEEP_WATER: 0x1d4a63,
  ICE: 0x9fc7d8,
  WEB: 0xcfc9bd,
  MUD: 0x5a4632,
  LAVA: 0xc2461c,
  CHASM: 0x14110f,
  WALL: 0x3b352e,
};

/**
 * How much of a tile's colour survives its light level.
 *
 * <p>A tint under an orthographic camera, and the same numbers become real light
 * intensities when a perspective camera and actual lights arrive — which is why
 * this is a multiplier rather than a palette of pre-darkened colours.
 */
export const LIGHT_FACTOR: Record<LightLevel, number> = {
  BRIGHT: 1,
  DIM: 0.55,
  DARKNESS: 0.22,
};

/** Half-feet across one cell of this map. */
export function cellSize(map: BattleMap): number {
  return map.cellFeet * 2;
}

/** The painted cell at these indices, or null where the map's defaults apply. */
function cellAt(map: BattleMap, x: number, y: number): MapCell | null {
  return map.cells.find(c => c.x === x && c.y === y) ?? null;
}

/**
 * Whether this square blocks sight.
 *
 * <p>An explicit `opaque` wins; otherwise a wall blocks and nothing else does —
 * the same rule the server applies, kept in step because a board that drew
 * different walls from the ones the engine traces through would be worse than no
 * board.
 */
export function opaqueAt(map: BattleMap, cell: MapCell | null): boolean {
  if (cell?.opaque != null) {
    return cell.opaque;
  }
  return (cell?.terrain ?? map.defaultTerrain) === 'WALL';
}

/** Darkens a colour by a light factor, channel by channel. */
export function shade(colour: number, factor: number): number {
  const r = Math.round(((colour >> 16) & 0xff) * factor);
  const g = Math.round(((colour >> 8) & 0xff) * factor);
  const b = Math.round((colour & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/**
 * Every square of the board, painted or not.
 *
 * <p>The whole grid, not only the sparse rows: storage is sparse because most
 * squares are the default, but a renderer has to draw the default ones too.
 */
export function terrainTiles(map: BattleMap): TerrainTile[] {
  const size = cellSize(map);
  const tiles: TerrainTile[] = [];

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const cell = cellAt(map, x, y);
      const kind = cell?.terrain ?? map.defaultTerrain;
      const light = cell?.light ?? map.defaultLight;
      const base = (cell?.elevationFeet ?? 0) * 2;
      tiles.push({
        // Centre rather than corner, because a token's position is a centre and
        // mixing the two is the kind of half-cell drift nobody sees until a
        // Gargantuan creature is a square off.
        x: x * size + size / 2,
        y: y * size + size / 2,
        size,
        base,
        height: kind === 'WALL' ? WALL_HEIGHT : 0,
        kind,
        light,
        opaque: opaqueAt(map, cell),
        cover: cell?.cover ?? (kind === 'WALL' ? 'TOTAL' : 'NONE'),
        colour: shade(TERRAIN_COLOURS[kind], LIGHT_FACTOR[light]),
      });
    }
  }
  return tiles;
}

/** The ground level under a point, in half-feet. */
export function groundAt(map: BattleMap, xHalfFeet: number, yHalfFeet: number): number {
  const size = cellSize(map);
  const cell = cellAt(map, Math.floor(xHalfFeet / size), Math.floor(yHalfFeet / size));
  return (cell?.elevationFeet ?? 0) * 2;
}

const ON_DECK_COLOUR = 0x6f6a7d;
const DOWN_COLOUR = 0x4a4a4a;
const BLOODIED_COLOUR = 0x9c3b30;
const HEALTHY_COLOUR = 0x4f7d5c;

/**
 * Tokens from a saved encounter — the board before anybody rolls.
 *
 * <p>Nothing here is bloodied or acting, because none of that exists yet. That
 * is the Combatant/Participant split showing through: this is where a creature
 * was placed, not what a fight did to it.
 */
export function encounterTokens(encounter: Encounter): TokenPlacement[] {
  return encounter.combatants
    .filter(c => c.disposition !== 'REMOVED')
    .map(c => token(encounter.map, c.id, c.name ?? 'Creature', c, c.spaceHalfFeet, {
      down: false,
      bloodied: false,
      acting: false,
      onDeck: c.disposition === 'ON_DECK',
    }));
}

/**
 * Tokens from a running battle.
 *
 * <p>Positions come from the participants rather than the combatants: the
 * participant is where a creature *is*, the combatant is where it started, and
 * drawing the second during a fight would paint everyone back at their opening
 * marks.
 */
export function battleTokens(
  map: BattleMap,
  battle: Battle,
  sizes: ReadonlyMap<string, number>,
): TokenPlacement[] {
  const all: Participant[] = [...battle.order, ...battle.onDeck];
  return all
    .filter(p => p.disposition !== 'REMOVED')
    .map(p => token(map, p.id, p.name, p, sizeOf(p, sizes), {
      down: p.down,
      bloodied: p.bloodied,
      acting: p.id === battle.currentParticipantId,
      onDeck: p.disposition === 'ON_DECK',
    }));
}

/**
 * A participant's footprint.
 *
 * <p>Taken from the combatant it came from, because the tracker deliberately
 * does not carry a size — it is a fight, not a board. Medium is the fallback,
 * which is what the server assumes too.
 */
function sizeOf(p: Participant, sizes: ReadonlyMap<string, number>): number {
  return (p.combatantId ? sizes.get(p.combatantId) : undefined) ?? 10;
}

interface TokenState {
  down: boolean;
  bloodied: boolean;
  acting: boolean;
  onDeck: boolean;
}

function token(
  map: BattleMap,
  id: string,
  name: string,
  at: { xHalfFeet: number; yHalfFeet: number; zHalfFeet: number },
  size: number,
  state: TokenState,
): TokenPlacement {
  return {
    id,
    name,
    x: at.xHalfFeet,
    y: at.yHalfFeet,
    // The ground under it, plus whatever it is flying. Elevation and flight are
    // one axis, so a creature on a balcony and one hovering draw the same way.
    z: groundAt(map, at.xHalfFeet, at.yHalfFeet) + at.zHalfFeet + TOKEN_LIFT,
    size,
    down: state.down,
    bloodied: state.bloodied,
    acting: state.acting,
    onDeck: state.onDeck,
    colour: state.down ? DOWN_COLOUR
      : state.onDeck ? ON_DECK_COLOUR
      : state.bloodied ? BLOODIED_COLOUR
      : HEALTHY_COLOUR,
  };
}

/** The whole scene for an encounter, before a fight. */
export function sceneForEncounter(encounter: Encounter): BoardScene {
  return {
    tiles: terrainTiles(encounter.map),
    tokens: encounterTokens(encounter),
    widthHalfFeet: encounter.map.width * cellSize(encounter.map),
    heightHalfFeet: encounter.map.height * cellSize(encounter.map),
  };
}

/** The whole scene for a battle running on an encounter's board. */
export function sceneForBattle(encounter: Encounter, battle: Battle): BoardScene {
  const sizes = new Map(encounter.combatants.map(c => [c.id, c.spaceHalfFeet]));
  return {
    tiles: terrainTiles(encounter.map),
    tokens: battleTokens(encounter.map, battle, sizes),
    widthHalfFeet: encounter.map.width * cellSize(encounter.map),
    heightHalfFeet: encounter.map.height * cellSize(encounter.map),
  };
}

/** Cover as the number it is worth, for a legend or a tooltip. */
export function coverBonus(cover: CoverDegree): number {
  switch (cover) {
    case 'HALF': return 2;
    case 'THREE_QUARTERS': return 5;
    default: return 0;
  }
}
