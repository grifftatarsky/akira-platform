package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.model.encounter.Encounter;
import java.util.UUID;

/**
 * An encounter in a list, without its board.
 *
 * <p>A full {@link EncounterResponse} carries every painted square and every
 * token; a page of forty of those to render a list of names is a lot of board
 * nobody is looking at.
 */
public record EncounterSummaryResponse(
    UUID id,
    String name,
    String description,
    int width,
    int height,
    int cellFeet,
    int combatantCount) {

  public static EncounterSummaryResponse from(Encounter e) {
    return new EncounterSummaryResponse(e.getId(), e.getName(), e.getDescription(),
        e.getMap().getWidth(), e.getMap().getHeight(), e.getMap().getCellFeet(),
        e.getCombatants().size());
  }
}
