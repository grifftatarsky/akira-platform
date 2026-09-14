package com.gpt.oozengine.constant.rules;

/** The six abilities. {@code abbrev} matches how the SRD prints them in stat blocks. */
public enum Ability {
  STRENGTH("Str"),
  DEXTERITY("Dex"),
  CONSTITUTION("Con"),
  INTELLIGENCE("Int"),
  WISDOM("Wis"),
  CHARISMA("Cha");

  private final String abbrev;

  Ability(String abbrev) {
    this.abbrev = abbrev;
  }

  public String abbrev() {
    return abbrev;
  }
}
