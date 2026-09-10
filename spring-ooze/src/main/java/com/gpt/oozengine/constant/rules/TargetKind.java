package com.gpt.oozengine.constant.rules;

/** What a feature is aimed at. {@link #EACH_IN_AREA} defers to the feature's area
 * shape; {@link #N_CREATURES} pairs with {@code targetCount}. */
public enum TargetKind {
  NONE,
  SELF,
  ONE_CREATURE,
  ONE_OBJECT,
  ONE_CREATURE_OR_OBJECT,
  N_CREATURES,
  EACH_IN_AREA,
  POINT,
  SPECIAL
}
