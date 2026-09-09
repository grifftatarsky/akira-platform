/**
 * What the board draws, and what the server sends it.
 *
 * <p>The engine's length unit is the half-foot, because every distance the SRD
 * states is a multiple of 5 feet and a Tiny creature's square is 2½ — so
 * half-feet make all of them exact integers. The board keeps that unit as its
 * world unit rather than converting: a renderer that divided by two would be the
 * one place in the stack where a rounding decision lived.
 */

export type TerrainKind =
  | 'FLOOR' | 'RUBBLE' | 'WATER' | 'DEEP_WATER' | 'ICE' | 'WEB' | 'MUD' | 'LAVA'
  | 'CHASM' | 'WALL';

export type LightLevel = 'BRIGHT' | 'DIM' | 'DARKNESS';

export type CoverDegree = 'NONE' | 'HALF' | 'THREE_QUARTERS' | 'TOTAL';

export type Disposition = 'ACTIVE' | 'ON_DECK' | 'REMOVED';

/**
 * The pieces a board is built from, named by what they are rather than by file.
 *
 * <p>Here rather than beside the art, because this is the board's own
 * vocabulary: a scene says "a table stands on that square" and a theme is only
 * a lookup from that word to a model. Put the words in the theme and every
 * consumer of a scene has to import the art to read it.
 *
 * <p>Split by how a piece is chosen, not by what it looks like. Structure is
 * derived — the square is a wall, so a wall piece goes there. Props are placed,
 * because which corner the barrels are stacked in is a decision and no rule
 * about the floor produces it.
 */
export type BoardPiece =
  // Structure, chosen by the terrain under it.
  | 'FLOOR'
  | 'FLOOR_ROUGH'
  | 'FLOOR_DIRT'
  | 'WALL'
  | 'WALL_CORNER'
  | 'WALL_ARCH'
  | 'WALL_TSPLIT'
  | 'DOORWAY'
  // Placed.
  | 'PILLAR'
  | 'PILLAR_DECORATED'
  | 'COLUMN'
  | 'STAIRS'
  | 'BARRIER'
  | 'BARREL'
  | 'BARRELS'
  | 'CRATE'
  | 'CRATES'
  | 'CHEST'
  | 'TABLE'
  | 'TABLE_BROKEN'
  | 'CHAIR'
  | 'STOOL'
  | 'KEG'
  | 'SHELVES'
  | 'SHELF_CANDLES'
  | 'BED'
  | 'TORCH'
  | 'CANDLES'
  | 'BANNER_BLUE'
  | 'BANNER_GREEN'
  | 'RUBBLE'
  | 'RUBBLE_SMALL'
  | 'ARMS'
  | 'COINS'
  | 'TRUNK'
  | 'BOTTLE'
  | 'PLATE';

/** One painted square. Nulls mean "the map's default", which is why it is sparse. */
export interface MapCell {
  readonly x: number;
  readonly y: number;
  readonly elevationFeet: number | null;
  readonly terrain: TerrainKind | null;
  readonly light: LightLevel | null;
  readonly cover: CoverDegree | null;
  readonly opaque: boolean | null;
  readonly extraMoveCostFeet: number | null;
  readonly notes: string | null;
}

export interface BattleMap {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly cellFeet: number;
  readonly defaultTerrain: TerrainKind;
  readonly defaultLight: LightLevel;
  readonly cells: readonly MapCell[];
}

export interface Combatant {
  readonly id: string;
  /**
   * Exactly one of these two is set, enforced by a check constraint on the
   * server. They are carried here because updating a placement is a whole-object
   * PUT — sending it back without the base would violate that constraint, and
   * "combatants must have exactly one base" is a confusing 500 to debug from a
   * drag.
   */
  readonly statBlockId: string | null;
  readonly gameCharacterId: string | null;
  readonly name: string | null;
  readonly xHalfFeet: number;
  readonly yHalfFeet: number;
  readonly zHalfFeet: number;
  readonly disposition: Disposition;
  readonly surprised: boolean;
  readonly size: string | null;
  readonly spaceHalfFeet: number;
  readonly capabilities: readonly string[];
}

export interface Encounter {
  readonly id: string;
  readonly name: string;
  readonly map: BattleMap;
  readonly combatants: readonly Combatant[];
}

export interface Participant {
  readonly id: string;
  readonly name: string;
  readonly initiative: number | null;
  readonly currentHitPoints: number;
  readonly maxHitPoints: number;
  readonly down: boolean;
  readonly bloodied: boolean;
  readonly conditions: readonly string[];
  readonly disposition: Disposition;
  readonly xHalfFeet: number;
  readonly yHalfFeet: number;
  readonly zHalfFeet: number;
  readonly speedFeet: number;
  readonly movementRemainingFeet: number;
  readonly combatantId: string | null;
}

export interface Battle {
  readonly id: string;
  readonly name: string;
  readonly encounterId: string | null;
  readonly phase: string;
  readonly round: number;
  readonly currentParticipantId: string | null;
  readonly order: readonly Participant[];
  readonly onDeck: readonly Participant[];
}

// region What the renderer consumes
//
// Described as data rather than drawn directly, for two reasons. It is testable
// without a WebGL context, which jsdom does not have — so every rule about what
// the board *shows* is provable in the same suite as everything else. And it
// keeps the renderer swappable: nothing below names three.

/**
 * One square of ground.
 *
 * <p><b>Height is real from the first frame.</b> A flat floor is a box of zero
 * height and a wall is a box of eight feet, which under a top-down orthographic
 * camera looks exactly like a flat tile — and under a perspective camera is
 * already a wall. That is the whole of "build for 3D": the geometry is
 * three-dimensional now, and only the camera is locked.
 */
export interface TerrainTile {
  /** Centre, in half-feet. */
  readonly x: number;
  readonly y: number;
  /** Side of the square, in half-feet. */
  readonly size: number;
  /** Ground level, in half-feet. */
  readonly base: number;
  /** How far it stands proud of its base — 0 for floor, a wall's height for a wall. */
  readonly height: number;
  readonly kind: TerrainKind;
  readonly light: LightLevel;
  readonly opaque: boolean;
  readonly cover: CoverDegree;
  /**
   * Radians about Z, for a model that is not symmetrical.
   *
   * <p>A wall piece is a long, thin thing: it has to lie along the run it is
   * part of, or a room comes out with its side walls facing the wrong way and
   * gaps between them. Worked out from the neighbours rather than stored,
   * because it is a fact about the shape of the wall and not about the square.
   */
  readonly rotation: number;
  /**
   * What the square looks like in the light it is in.
   *
   * <p>For a renderer that has no lighting of its own — light folded into the
   * colour is the only way a flat drawing can show a dark room.
   */
  readonly colour: number;
  /**
   * The same square's material, before any light reaches it.
   *
   * <p>Both are carried because a renderer that *does* light the scene must not
   * use the first. Shading the colour and then laying a dark film over the
   * square applies the light level twice: deep water in an unlit room came out
   * at five per cent of its own colour, which is to say black, and a DM could
   * not tell a flooded cellar from a chasm.
   */
  readonly baseColour: number;
}

/** One creature on the board. */
export interface TokenPlacement {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** Ground level under the token, plus anything it is flying. */
  readonly z: number;
  /** The side of its square, in half-feet — 5 for Tiny, 40 for Gargantuan. */
  readonly size: number;
  readonly down: boolean;
  readonly bloodied: boolean;
  /** Whose turn it is; drawn with a ring. */
  readonly acting: boolean;
  /** Not yet in the fight, drawn faded. */
  readonly onDeck: boolean;
  readonly colour: number;
}

/**
 * One prop, standing somewhere.
 *
 * <p>Decoration, and deliberately not terrain. A square knows it is difficult
 * to cross and gives half cover; it does not know that the reason is a
 * barricade. Keeping the two apart means a DM can furnish a room without
 * changing what the engine computes, and — the part that matters — that
 * furniture can never quietly become a rule the server did not agree to.
 *
 * <p>The server has no column for this yet. `map_cells` carries terrain, light,
 * cover, elevation and cost, and nothing that says "a table stands here". This
 * is the shape that column will take.
 */
export interface PropPlacement {
  readonly piece: BoardPiece;
  /** Centre, in half-feet. */
  readonly x: number;
  readonly y: number;
  /**
   * How far above the ground under it, in half-feet. Zero for anything standing
   * on the floor; set for a banner hung on a wall or a chest on a ledge.
   */
  readonly z: number;
  /** Radians about Z, so a room is not all facing north. */
  readonly rotation: number;
}

/** Everything to draw, and how big the board is. */
export interface BoardScene {
  readonly tiles: readonly TerrainTile[];
  readonly tokens: readonly TokenPlacement[];
  readonly props: readonly PropPlacement[];
  /** Extent in half-feet, for framing the camera. */
  readonly widthHalfFeet: number;
  readonly heightHalfFeet: number;
}
// endregion
