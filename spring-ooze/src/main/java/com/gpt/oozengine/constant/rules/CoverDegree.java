package com.gpt.oozengine.constant.rules;

/**
 * How much protection a square gives a creature standing behind it.
 *
 * <p>From the glossary import: "Half Cover (+2 bonus to AC and Dexterity saving
 * throws), Three-Quarters Cover (+5 bonus to AC and Dexterity saving throws),
 * and Total Cover (can't be targeted directly). If behind more than one degree
 * of cover, a target benefits only from the most protective degree."
 *
 * <p>The ordinal order is that ranking, so "most protective" is a max.
 */
public enum CoverDegree {
  NONE(0),
  HALF(2),
  THREE_QUARTERS(5),
  /** Cannot be targeted directly at all; the bonus is meaningless. */
  TOTAL(0);

  private final int armorClassBonus;

  CoverDegree(int armorClassBonus) {
    this.armorClassBonus = armorClassBonus;
  }

  /** Also applies to Dexterity saving throws, per the same rule. */
  public int armorClassBonus() {
    return armorClassBonus;
  }

  public boolean blocksTargeting() {
    return this == TOTAL;
  }
}
