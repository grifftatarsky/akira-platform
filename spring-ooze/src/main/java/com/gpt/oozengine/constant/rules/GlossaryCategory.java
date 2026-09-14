package com.gpt.oozengine.constant.rules;

/**
 * The bracketed tag the Rules Glossary prints after some of its entries.
 *
 * <p>The book's own classification, not ours. {@link #CONDITION} is absent by
 * design: conditions are catalog content of their own, because an effect points
 * at one by id.
 */
public enum GlossaryCategory {
  ACTION,
  HAZARD,
  AREA_OF_EFFECT,
  ATTITUDE,
  /** From the Gameplay Toolbox rather than the glossary: named rules a DM looks
   * up the same way, kept in the same table so one search finds them. */
  ENVIRONMENT,
  CONTAGION
}
