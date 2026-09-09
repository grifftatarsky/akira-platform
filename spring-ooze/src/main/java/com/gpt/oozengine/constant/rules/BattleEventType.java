package com.gpt.oozengine.constant.rules;

/**
 * What happened, in a battle's log.
 *
 * <p>The log is the battle: live state is a fold over these, materialised into
 * columns so reads stay cheap. That is what makes undo a truncation rather than
 * a set of inverse operations, and what keeps the combat log a DM reads from
 * ever disagreeing with the state the engine holds.
 *
 * <p>Phase 3 covers turn order and bookkeeping. Action resolution adds its own
 * types later; nothing here needs to change to admit them.
 */
public enum BattleEventType {
  BATTLE_STARTED,
  PARTICIPANT_ADDED,

  /** Carries the dice, the bonus and whether Disadvantage applied. */
  INITIATIVE_ROLLED,
  INITIATIVE_ORDER_SET,

  ROUND_STARTED,
  TURN_STARTED,
  TURN_ENDED,

  /** An on-deck creature joins the fight and rolls into the order. */
  PARTICIPANT_PROMOTED,
  PARTICIPANT_REMOVED,

  HIT_POINTS_CHANGED,
  TEMPORARY_HIT_POINTS_SET,
  CONDITION_APPLIED,
  CONDITION_REMOVED,

  /**
   * Something the DM wrote down, or something the engine surfaced that changes
   * no state — the sprite's Heart Sight learning a target's alignment. This is
   * what the "things to consider" panel reads.
   */
  NOTE,

  BATTLE_ENDED
}
