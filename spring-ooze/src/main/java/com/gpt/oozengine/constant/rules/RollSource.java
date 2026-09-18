package com.gpt.oozengine.constant.rules;

/**
 * Where a number in the log came from.
 *
 * <p>Recorded on every roll, because "the goblin rolled a 19" and "the DM said
 * the goblin rolled a 19" are different claims and only one of them replays.
 */
public enum RollSource {
  /** The engine's own seeded roll. Reproducible from the battle's seed. */
  RANDOM,

  /** A DM rolled a real die and typed the result in. */
  MANUAL,

  /**
   * The book's printed average, taken instead of rolling — the fast path for
   * running an encounter many times, and for a DM who wants the expected case.
   */
  AVERAGE
}
