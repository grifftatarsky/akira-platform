package com.gpt.oozengine.constant.rules;

/**
 * Creature sizes, and the square each one occupies.
 *
 * <p><b>The engine's length unit is the half-foot, and it is an integer.</b>
 * Every distance the SRD states is a multiple of 5 feet, and the one exception
 * is this table: a Tiny creature occupies a 2½-foot square. Measuring in
 * half-feet makes that exact rather than rounded, and keeps every distance,
 * footprint and speed in the simulator an {@code int} — no floating point in the
 * geometry, so two positions that should be the same distance apart always are.
 *
 * <p>{@link #spaceFeet()} stays for display, because a DM reads feet.
 */
public enum CreatureSize {
  TINY(5),
  SMALL(10),
  MEDIUM(10),
  LARGE(20),
  HUGE(30),
  GARGANTUAN(40);

  private final int spaceHalfFeet;

  CreatureSize(int spaceHalfFeet) {
    this.spaceHalfFeet = spaceHalfFeet;
  }

  /** The side of the square this creature occupies, in half-feet. */
  public int spaceHalfFeet() {
    return spaceHalfFeet;
  }

  /** The same square in feet, for display. Tiny is the only fractional one. */
  public double spaceFeet() {
    return spaceHalfFeet / 2.0;
  }
}
