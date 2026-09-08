package com.gpt.oozengine.constant.rules;

/**
 * How a {@link com.gpt.oozengine.model.mechanics.Rider} changes its target.
 *
 * <p>Kept separate from {@link RiderTarget} because the same modes apply across
 * targets: Advantage on a save and Advantage on an attack are one rule, and a
 * flat bonus reads the same whether it lands on AC or on a damage roll.
 */
public enum RiderMode {
  ADVANTAGE,
  DISADVANTAGE,
  /** Add {@code amount}, which may be negative — the rust monster's -1. */
  BONUS,
  /** Halve the value. The book only ever halves Speed. */
  HALVE,
  /** Cannot be done at all: "The target can't take Reactions." */
  DENY,

  /**
   * Turns a failure into a success — Legendary Resistance's "If the dragon
   * fails a saving throw, it can choose to succeed instead."
   *
   * <p>Not a bonus of any size: the roll is not re-evaluated, its outcome is
   * replaced. How often is governed by the feature's own {@code usesMax} and
   * {@code usesReset}, which already parse as 3/Day on all 32 of them.
   */
  AUTO_SUCCEED
}
