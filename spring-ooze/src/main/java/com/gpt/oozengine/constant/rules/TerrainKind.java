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
