package com.gpt.oozengine.constant.rules;

/** Top-level item kind. Drives which detail block is populated: {@link #WEAPON}
 * rows carry a weapon detail, {@link #ARMOR} and {@link #SHIELD} an armor detail. */
public enum ItemCategory {
  WEAPON,
  ARMOR,
  SHIELD,
  AMMUNITION,
  ADVENTURING_GEAR,
  POISON,
  TOOL,
  MOUNT_OR_VEHICLE,
  POTION,
  RING,
  ROD,
  SCROLL,
  STAFF,
  WAND,
  WONDROUS_ITEM,
  OTHER
}
