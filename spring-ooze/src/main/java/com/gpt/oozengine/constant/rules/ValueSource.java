package com.gpt.oozengine.constant.rules;

/**
 * Where an attack bonus or save DC comes from.
 *
 * <p>A monster's numbers are baked in ({@link #FIXED}) because a stat block is a
 * finished creature. A spell's are not: Fireball's DC is the caster's spell save
 * DC, so the same spell row has to yield a different number per caster. Storing
 * the source alongside the value is what lets one {@code Feature} serve both.
 */
public enum ValueSource {
  FIXED,
  SPELL_SAVE_DC,
  SPELL_ATTACK_BONUS,
  WEAPON_ATTACK,
  DERIVED
}
