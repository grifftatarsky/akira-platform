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
  /** Base colour, before light. */
  readonly colour: number;
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

/** Everything to draw, and how big the board is. */
export interface BoardScene {
  readonly tiles: readonly TerrainTile[];
  readonly tokens: readonly TokenPlacement[];
  /** Extent in half-feet, for framing the camera. */
  readonly widthHalfFeet: number;
  readonly heightHalfFeet: number;
}
// endregion
