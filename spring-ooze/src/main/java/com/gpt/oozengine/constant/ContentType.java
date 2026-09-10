package com.gpt.oozengine.constant;

/**
 * Catalog content kinds. Used to scope per-user suppressions
 * ({@code hidden_content}) to the right table without a polymorphic FK.
 */
public enum ContentType {
  SPELL,
  ITEM,
  BACKGROUND,
  SPECIES,
  VOCATION,
  MONSTER,
  FEAT,
  CONDITION,
  WEAPON_MASTERY,
  GLOSSARY,
  TRAP
}
