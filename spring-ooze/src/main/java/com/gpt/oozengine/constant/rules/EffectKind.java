package com.gpt.oozengine.constant.rules;

/** What an effect does once its branch is taken. */
public enum EffectKind {
  DAMAGE,
  HEALING,
  TEMPORARY_HIT_POINTS,
  APPLY_CONDITION,
  REMOVE_CONDITION,
  MOVEMENT,
  ABILITY_SCORE_CHANGE,
  RESOURCE_CHANGE,
  SUMMON,

  /**
   * Grants or imposes {@link com.gpt.oozengine.model.mechanics.Rider}s — the
   * book's "has Disadvantage on…", "its Speed is halved", "adds 2 to its AC".
   * One effect can carry several: Slowing Breath denies Reactions, halves Speed
   * and caps attacks in a single Failure clause.
   */
  APPLY_RIDER,

  /**
   * The creature becomes something else — size and speeds change, statistics do
   * not. Size matters mechanically here because it sets the footprint, and the
   * footprint sets reach and cover.
   */
  SHAPE_CHANGE,

  /**
   * Something the DM should know that changes no state: the sprite's Heart
   * Sight learning a target's emotions and alignment. Surfaced on the turn for
   * the DM to weigh rather than silently dropped.
   */
  INFORMATION,
  AREA_TERRAIN,
  SPECIAL
}
