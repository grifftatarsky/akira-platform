package com.gpt.oozengine.constant.rules;

/**
 * Whether a combatant is in the fight.
 *
 * <p>Deliberately separate from surprise and from being hidden, which are two
 * other axes entirely: a creature can be in the initiative order and hidden, or
 * on deck and perfectly visible.
 */
public enum Disposition {
  /** In the fight from the start, and rolls Initiative with everyone else. */
  ACTIVE,

  /**
   * Present in the scene but not in combat — asleep, around the corner, on the
   * balcony, or arriving on round three. The DM promotes one at any moment and
   * it rolls Initiative then, which is the whole of the ambush, reinforcement
   * and "the ogre wakes up" mechanism.
   */
  ON_DECK,

  /** Left the battlefield. Kept rather than deleted so the log still resolves. */
  REMOVED
}
