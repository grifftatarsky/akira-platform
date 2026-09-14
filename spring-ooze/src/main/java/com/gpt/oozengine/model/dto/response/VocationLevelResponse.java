package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.model.ClassValue;
import com.gpt.oozengine.model.VocationLevel;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * One row of a class's level table, as the book prints it.
 *
 * <p>{@code classValues} is the columns no other class has — Rages, Sneak
 * Attack, Martial Arts, Focus Points — kept as a labelled list rather than as a
 * column per class, which would mean a migration every time a class is added,
 * and in the order the book prints them.
 */
public record VocationLevelResponse(
    int level,
    int proficiencyBonus,
    String featureSummary,
    Integer cantripsKnown,
    Integer preparedSpells,
    Map<Integer, Integer> spellSlots,
    List<ClassValue> classValues) {

  public static VocationLevelResponse from(VocationLevel l) {
    return new VocationLevelResponse(
        l.getLevel(),
        l.getProficiencyBonus(),
        l.getFeatureSummary(),
        l.getCantripsKnown(),
        l.getPreparedSpells(),
        // A TreeMap, not Map.copyOf: that returns an unordered map, and slots
        // read by spell level.
        new TreeMap<>(l.getSpellSlots()),
        List.copyOf(l.getClassValues()));
  }
}
