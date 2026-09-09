package com.gpt.oozengine.constant.rules;

/**
 * Where a battle has got to.
 *
 * <p>The engine advances until it needs a decision and then stops, so these are
 * the places it can be stopped. {@link #BETWEEN_TURNS} is the visible pause: the
 * moment a DM can take a reaction, fire an environmental effect, or walk an
 * on-deck creature into the fight before the next turn begins.
 */
public enum BattlePhase {
  /** Participants are still being added; nobody has rolled anything. */
  SETUP,

  /** Everyone in the fight rolls, and the order is fixed. */
  ROLLING_INITIATIVE,

  /** A participant's turn is open and the DM is acting for them. */
  IN_TURN,

  /**
   * The pause between one turn and the next.
   *
   * <p>Not cosmetic. Reactions, environmental effects and a surprise arrival all
   * happen here, and a tracker that ran straight from one turn to the next would
   * give a DM nowhere to put them.
   */
  BETWEEN_TURNS,

  ENDED
}
