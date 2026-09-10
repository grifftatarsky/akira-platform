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
  | 'FLOOR' | 'GRASS' | 'ROAD' | 'RUBBLE' | 'WATER' | 'DEEP_WATER' | 'ICE' | 'WEB'
  | 'MUD' | 'LAVA' | 'CHASM' | 'WALL';

export type LightLevel = 'BRIGHT' | 'DIM' | 'DARKNESS';

export type CoverDegree = 'NONE' | 'HALF' | 'THREE_QUARTERS' | 'TOTAL';

export type Disposition = 'ACTIVE' | 'ON_DECK' | 'REMOVED';

/**
 * A piece of board chosen by the square under it.
 *
 * <p>Derived, so it is never stored: the square is a wall, so a wall piece goes
 * there. Repaint the square and the piece follows.
 */
export type TerrainPiece = 'FLOOR' | 'FLOOR_ROUGH' | 'FLOOR_DIRT' | 'WALL';

/**
 * A piece somebody put somewhere.
 *
 * <p>Placed rather than derived, which is the whole distinction — no rule about
 * a square produces "and the barrels are stacked in that corner". Mirrors the
 * server's `PropKind` exactly, because these are stored: a value the two ends
 * disagree about is a saved board that draws nothing.
 *
 * <p>Named for what the thing is and never for the file that draws it, so
 * replacing the art pack changes a theme and not one row of anybody's board.
 */
export type PropKind =
  // Structure a DM places rather than paints. A doorway stands on a *floor*
  // square: the gap in the wall has to be walkable, or it seals the room.
  | 'DOORWAY'
  | 'WALL_ARCH'
  | 'WALL_CORNER'
  | 'WALL_TSPLIT'
  | 'PILLAR'
  | 'PILLAR_DECORATED'
  | 'COLUMN'
  | 'STAIRS'
  | 'BARRIER'
  // Storage and furniture.
  | 'BARREL'
  | 'BARRELS'
  | 'CRATE'
  | 'CRATES'
  | 'CHEST'
  | 'TRUNK'
  | 'KEG'
  | 'SHELVES'
  | 'SHELF_CANDLES'
  | 'TABLE'
  | 'TABLE_BROKEN'
  | 'CHAIR'
  | 'STOOL'
  | 'BED'
  // Light, which is the one of these the engine will want first.
  | 'TORCH'
  | 'CANDLES'
  // Dressing.
  | 'BANNER_BLUE'
  | 'BANNER_GREEN'
  | 'RUBBLE'
  | 'RUBBLE_SMALL'
  | 'ARMS'
  | 'COINS'
  | 'BOTTLE'
  | 'PLATE';

/** Everything a theme can be asked to draw. */
export type BoardPiece = TerrainPiece | PropKind;

/**
 * One prop as the server stores it.
 *
 * <p>Position is continuous like a creature's, not a cell index like a painted
 * square's: terrain is a raster and furniture is not, and a table across the
 * middle of two squares is a thing a DM should be able to do.
 *
 * @param zHalfFeet height above the *ground under it*, not above zero — so a
 *     chest carried onto a ten-foot dais needs no elevation edited
 * @param facingDegrees clockwise, 0 to 359. Degrees rather than radians because
 *     every other measurement in the schema is a whole number.
 */
export interface MapProp {
  readonly piece: PropKind;
  readonly xHalfFeet: number;
  readonly yHalfFeet: number;
  readonly zHalfFeet: number;
  readonly facingDegrees: number;
}

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
  /**
   * The furniture.
   *
   * <p>On the map rather than beside it, because that is where the server keeps
   * it — one JSON column, written whole and read whole. Cover, Difficult
   * Terrain and light all stay on the cells, so furnishing a room changes
   * nothing the engine computes.
   */
  readonly props: readonly MapProp[];
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
   * color is the only way a flat drawing can show a dark room.
   */
  readonly color: number;
  /**
   * The same square's material, before any light reaches it.
   *
   * <p>Both are carried because a renderer that *does* light the scene must not
   * use the first. Shading the color and then laying a dark film over the
   * square applies the light level twice: deep water in an unlit room came out
   * at five per cent of its own color, which is to say black, and a DM could
   * not tell a flooded cellar from a chasm.
   */
  readonly baseColor: number;
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
  readonly color: number;
}

/**
 * One prop, ready to draw.
 *
 * <p>A {@link MapProp} with the two questions the renderer cannot answer
 * resolved: which floor it stands on, and its facing in the unit three wants.
 * Kept apart from the stored shape for the same reason a token is kept apart
 * from a combatant — one is what was saved, the other is where it ends up on
 * screen.
 */
export interface PropPlacement {
  /**
   * Narrower than {@link BoardPiece} on purpose: a floor or a wall piece is
   * chosen by the square under it and can never be something somebody placed.
   */
  readonly piece: PropKind;
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
