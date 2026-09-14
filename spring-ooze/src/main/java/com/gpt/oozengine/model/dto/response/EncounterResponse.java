package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.model.encounter.Encounter;
import java.util.List;
import java.util.UUID;

/** A whole board: the map, its painted squares, and everything on it. */
public record EncounterResponse(
    UUID id,
    String name,
    String description,
    BattleMapResponse map,
    List<CombatantResponse> combatants) {

  public static EncounterResponse from(Encounter e) {
    return new EncounterResponse(e.getId(), e.getName(), e.getDescription(),
        BattleMapResponse.from(e.getMap()),
        e.getCombatants().stream().map(CombatantResponse::from).toList());
  }
}
