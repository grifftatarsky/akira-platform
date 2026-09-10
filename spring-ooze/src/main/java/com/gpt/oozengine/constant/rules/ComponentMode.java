package com.gpt.oozengine.constant.rules;

/**
 * How one line of a Multiattack contributes to the turn.
 *
 * <p>Without this, "the assassin makes three attacks, using Shortsword or Light
 * Crossbow in any combination" and "the assassin makes three Shortsword attacks
 * and three Light Crossbow attacks" are the same rows — which is six attacks
 * instead of three. Half the book's Multiattacks are a choice, a replacement or
 * an alternative rather than a fixed list, so the distinction is the difference
 * between a plan a simulator can run and one it can only print.
 */
public enum ComponentMode {

  /** Make {@code count} of this. The plain case: "makes two Rend attacks". */
  FIXED,

  /**
   * Distribute {@code count} attacks over the components sharing this one's
   * choice group — "three attacks, using Shortsword or Light Crossbow in any
   * combination". Every member of the group carries the same count: it is the
   * size of the whole allowance, not a per-member limit.
   */
  CHOICE,

  /**
   * May replace {@code count} of the attacks already planned — "it can replace
   * one attack with a use of Spellcasting". Adds nothing to the attack total.
   */
  REPLACEMENT,

  /**
   * A different plan for the same Multiattack, taken instead of the FIXED and
   * CHOICE components rather than alongside them — the Barbed Devil's "or it
   * makes two Hurl Flame attacks". One alternative per choice group.
   */
  ALTERNATIVE
}
