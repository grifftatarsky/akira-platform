package com.gpt.oozengine.constant.rules;

/**
 * How a limited-use feature comes back. {@link #RECHARGE} pairs with the
 * {@code rechargeMin}/{@code rechargeMax} fields — the SRD's "(Recharge 5–6)"
 * is a d6 rolled at the start of each turn.
 */
public enum UsesReset {
  AT_WILL,
  RECHARGE,

  /**
   * Once between one of the creature's turns and the next — the SRD's "The
   * dragon can't take this action again until the start of its next turn."
   *
   * <p>Half the legendary actions in the bestiary say this (41 of 82) and it is
   * not the same as {@link #PER_DAY} or a {@code usesMax} of 1: the allowance
   * comes back every round, so a simulator that ignored it would let a dragon
   * spend all three of its legendary uses on Commanding Presence.
   */
  PER_ROUND,

  PER_DAY,
  SHORT_REST,
  LONG_REST,
  DAWN,
  SPECIAL
}
