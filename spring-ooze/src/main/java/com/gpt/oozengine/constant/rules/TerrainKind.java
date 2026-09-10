package com.gpt.oozengine.constant.rules;

/**
 * What a square of the battlefield is made of.
 *
 * <p>Separate from the movement cost and the cover it grants, because those are
 * consequences a DM may want to override: a rubble-strewn floor is normally
 * Difficult Terrain, but this particular rubble might not be.
 */
public enum TerrainKind {
  FLOOR,
  /**
   * Open ground, outdoors. Costs nothing extra and grants nothing — the same
   * rules as a floor, and a different thing to look at, which is the whole
   * reason it is its own value: a board has to be able to say what a square is
   * made of even where that makes no difference to a die roll.
   */
  GRASS,
  /** A made track. Also rules-identical to a floor, and not made of grass. */
  ROAD,
  RUBBLE,
  WATER,
  DEEP_WATER,
  ICE,
  WEB,
  MUD,
  LAVA,
  CHASM,
  /** Impassable and sight-blocking; the default {@code opaque} for a cell. */
  WALL
}
