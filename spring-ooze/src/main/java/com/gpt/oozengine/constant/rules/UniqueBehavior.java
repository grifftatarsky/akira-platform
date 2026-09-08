package com.gpt.oozengine.constant.rules;

/**
 * A creature whose rules do not fit any general mechanism, handled by name.
 *
 * <p>The escape hatch is deliberate and deliberately small. A hydra's heads
 * drive its Multiattack count, its Reaction count and its own death, and no
 * amount of generalising makes that a rider or an effect — but there is exactly
 * one hydra, so a named branch plus a JSON blob of its state is both honest and
 * cheaper than a rules language nobody else uses.
 *
 * <p>Each value pairs with a shape in {@code stat_blocks.unique_data} that the
 * matching handler in {@code UniqueBehaviorService} owns. Adding a value means
 * adding a handler; the service fails loudly rather than silently doing nothing.
 */
public enum UniqueBehavior {
  /**
   * Five heads that die to 25 damage in a turn, regrow two-for-one unless the
   * hydra took Fire damage, and set how many Bite attacks its Multiattack makes.
   *
   * <p>{@code {"heads": 5, "startingHeads": 5, "damageThisTurn": 0,
   * "headsLostSinceLastTurn": 0, "tookFireDamage": false}}
   */
  HYDRA_HEADS,

  /**
   * Shrieks on its own, with no one choosing to: the trigger is another
   * creature's movement, not a decision. The simulator resolves it rather than
   * offering it.
   *
   * <p>{@code {"triggerRadiusFeet": 30, "audibleFeet": 300, "shriekingUntil":
   * null}}
   */
  SHRIEKER_SHRIEK
}
