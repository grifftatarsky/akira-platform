package com.gpt.oozengine.constant.rules;

/**
 * How well lit a square is.
 *
 * <p>Combat geometry, not scenery. We import Bright Light, Dim Light, Darkness,
 * Lightly Obscured, Heavily Obscured and Darkvision, and the glossary is blunt
 * about what the last one costs: "You have the Blinded condition while trying to
 * see something in a Heavily Obscured space."
 */
public enum LightLevel {
  BRIGHT,
  /** Lightly Obscured: Disadvantage on Wisdom (Perception) checks that rely on sight. */
  DIM,
  /** Heavily Obscured, unless the looker has Darkvision reaching this far. */
  DARKNESS
}
