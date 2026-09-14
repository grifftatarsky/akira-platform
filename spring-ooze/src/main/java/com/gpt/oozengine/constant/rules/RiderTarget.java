package com.gpt.oozengine.constant.rules;

/**
 * What a {@link com.gpt.oozengine.model.mechanics.Rider} modifies.
 *
 * <p>Riders are the book's third mechanical voice, alongside damage and
 * conditions: "has Advantage on attack rolls", "its Speed is halved", "adds 2 to
 * its AC", "subtracts 1d6 from its damage rolls". They are not conditions — no
 * condition in the SRD means "Disadvantage on Strength-based D20 Tests" — and
 * they are not damage. Without them a Pack Tactics creature attacks as if alone
 * and a Slowing Breath does nothing at all.
 */
public enum RiderTarget {
  /** Attack rolls made by the holder. */
  ATTACK_ROLL,
  /** Any D20 Test, the 2024 book's umbrella for checks, saves and attacks. */
  D20_TEST,
  ABILITY_CHECK,
  SAVING_THROW,
  /** Damage the holder deals. */
  DAMAGE_ROLL,
  /** The holder's Armor Class. */
  ARMOR_CLASS,
  SPEED,
  INITIATIVE,
  /** The AC a worn piece of armor offers — the rust monster's corrosion. */
  ITEM_ARMOR_CLASS,
  /** The attack bonus a wielded weapon offers. */
  ITEM_ATTACK_ROLL,
  /** Taking Reactions at all. */
  REACTION,
  /** Hit Point maximum, which the wraith's Life Drain lowers. */
  HIT_POINT_MAXIMUM
}
