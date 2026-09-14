package com.gpt.oozengine.constant.rules;

/**
 * Armor training groups. The category sets how Dexterity applies to AC and how
 * long the armor takes to don.
 *
 * <p>The don and doff times are printed once per section of the Armor table
 * rather than per row, because they are a property of the category and not of
 * the armor — so they live here rather than as two columns repeated down every
 * armor in the catalog.
 */
public enum ArmorCategory {
  LIGHT(1, 1),
  MEDIUM(5, 1),
  HEAVY(10, 5),
  /** A Shield is donned and doffed with a Utilize action, not over minutes. */
  SHIELD(0, 0);

  private final int donMinutes;
  private final int doffMinutes;

  ArmorCategory(int donMinutes, int doffMinutes) {
    this.donMinutes = donMinutes;
    this.doffMinutes = doffMinutes;
  }

  public int donMinutes() {
    return donMinutes;
  }

  public int doffMinutes() {
    return doffMinutes;
  }
}
