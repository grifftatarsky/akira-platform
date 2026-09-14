package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.BattlePhase;
import com.gpt.oozengine.model.battle.Battle;
import java.util.UUID;

/** A battle in a list, without its log — which is the largest part of it. */
public record BattleSummaryResponse(
    UUID id,
    String name,
    UUID encounterId,
    BattlePhase phase,
    int round,
    int participantCount) {

  public static BattleSummaryResponse from(Battle b) {
    return new BattleSummaryResponse(b.getId(), b.getName(), b.getEncounterId(), b.getPhase(),
        b.getRound(), b.getParticipants().size());
  }
}
