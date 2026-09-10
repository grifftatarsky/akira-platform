package com.gpt.oozengine.model.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.List;
import java.util.Map;

/**
 * One row of a class's level table.
 *
 * <p>{@code level} is the row's identity — it is what the mapper matches on,
 * because a level table's rows are not created and destroyed, they are edited
 * in place, and 1 through 20 is a better key than an id the client has to keep.
 *
 * @param spellSlots keyed by spell level, so a level-5 Wizard's {@code {1: 4,
 *     2: 3, 3: 2}} is directly the pool the simulator spends
 * @param classValues the columns no other class has, in the book's order
 */
public record VocationLevelRequest(
    @Min(1) @Max(20) int level,
    int proficiencyBonus,
    String featureSummary,
    Integer cantripsKnown,
    Integer preparedSpells,
    Map<Integer, Integer> spellSlots,
    @Valid List<ClassValueRequest> classValues) {}
