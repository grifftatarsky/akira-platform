package com.gpt.oozengine.constant.rules;

/**
 * The machine-readable half of a feature's trigger.
 *
 * <p>{@code Feature.triggerText} already carried the book's words, which is
 * enough for a DM and useless to the engine: a simulator that must be true to
 * the table has to actually fire Undead Fortitude when the zombie hits 0 Hit
 * Points, not wait to be asked. This says <em>when</em>; the feature's steps and
 * effects already say what happens.
 *
 * <p>Pairs with {@code trigger_damage_type} and {@code trigger_threshold} on the
 * feature for the conditions that carry a number — "whenever the golem is
 * subjected to Lightning damage", "took 15+ Slashing damage during that turn".
 */
public enum TriggerEvent {
  /** Reactions, whose trigger the book states in prose and the DM adjudicates. */
  DECLARED_BY_TRIGGER_TEXT,

  ON_TURN_START,
  ON_TURN_END,

  /** Undead Fortitude, and anything else that intervenes at zero. */
  ON_DROP_TO_ZERO_HIT_POINTS,

  /** The Restoration family: a new body, elsewhere, after a stated delay. */
  ON_DEATH,

  /** Absorption traits, keyed to a damage type. */
  ON_DAMAGE_TAKEN,

  /** Reflective Carapace: targeted by a spell rather than hit by one. */
  ON_TARGETED_BY_SPELL,

  ON_HIT_BY_ATTACK,

  /** Berserk, Loathsome Limbs: conditions that only matter while Bloodied. */
  ON_TURN_START_WHILE_BLOODIED,
  ON_TURN_END_WHILE_BLOODIED,

  /** Gibbering, Shriek: something else moved or started its turn nearby. */
  ON_CREATURE_NEARBY
}
