package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.BattlePhase;
import com.gpt.oozengine.model.battle.Battle;
import com.gpt.oozengine.model.battle.BattleEvent;
import com.gpt.oozengine.service.BattleService;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * The whole fight: who is in it, in what order, and everything that happened.
 *
 * <p>{@link #order} is the initiative order as the engine computes it, not the
 * participant list — a client that sorted for itself would disagree the moment
 * somebody was promoted mid-round, which is exactly when it matters.
 *
 * <p>{@link #currentParticipantId} is null between turns, which is how a client
 * knows to draw the pause rather than a highlighted row.
 */
public record BattleResponse(
    UUID id,
    String name,
    UUID encounterId,
    BattlePhase phase,
    int round,
    long seed,
    UUID currentParticipantId,
    List<ParticipantResponse> order,
    List<ParticipantResponse> onDeck,
    List<BattleEventResponse> log) {

  public static BattleResponse from(Battle b) {
    var current = BattleService.current(b);
    return new BattleResponse(
        b.getId(), b.getName(), b.getEncounterId(), b.getPhase(), b.getRound(), b.getSeed(),
        current == null ? null : current.getId(),
        BattleService.order(b).stream().map(ParticipantResponse::from).toList(),
        b.getParticipants().stream()
            .filter(p -> p.getDisposition() == com.gpt.oozengine.constant.rules.Disposition.ON_DECK)
            .map(ParticipantResponse::from).toList(),
        b.getEvents().stream()
            .sorted(Comparator.comparingLong(BattleEvent::getSequence))
            .map(BattleEventResponse::from).toList());
  }
}
