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
    /** The action waiting on a window, or null. What a client renders the pause from. */
    PendingActionResponse pending,
    List<ParticipantResponse> order,
    List<ParticipantResponse> onDeck,
    List<BattleEventResponse> log) {

  /**
   * An action declared and not resolved.
   *
   * <p>{@link #eligibleReactorIds} is on the wire because the DM's next decision
   * is which of them reacts, and a client that worked the list out itself would
   * disagree with the engine the moment somebody spent a Reaction.
   */
  public record PendingActionResponse(
      UUID actorId,
      UUID featureId,
      String featureName,
      List<UUID> targetIds,
      Integer armorClassDelta,
      boolean cancelled,
      List<UUID> eligibleReactorIds) {}

  public static BattleResponse from(Battle b) {
    var current = BattleService.current(b);
    return new BattleResponse(
        b.getId(), b.getName(), b.getEncounterId(), b.getPhase(), b.getRound(), b.getSeed(),
        current == null ? null : current.getId(),
        pendingOf(b),
        BattleService.order(b).stream().map(ParticipantResponse::from).toList(),
        b.getParticipants().stream()
            .filter(p -> p.getDisposition() == com.gpt.oozengine.constant.rules.Disposition.ON_DECK)
            .map(ParticipantResponse::from).toList(),
        b.getEvents().stream()
            .sorted(Comparator.comparingLong(BattleEvent::getSequence))
            .map(BattleEventResponse::from).toList());
  }

  private static PendingActionResponse pendingOf(Battle b) {
    var p = b.getPending();
    if (!p.isPending()) {
      return null;
    }
    var actor = b.getParticipants().stream()
        .filter(x -> x.getId().equals(p.getActorId())).findFirst().orElse(null);
    return new PendingActionResponse(p.getActorId(), p.getFeatureId(), p.getFeatureName(),
        p.getTargetIds() == null ? List.of() : p.getTargetIds(),
        p.getArmorClassDelta(), p.wasCancelled(),
        actor == null ? List.of()
            : BattleService.eligibleReactors(b, actor).stream()
                .map(x -> x.getId()).toList());
  }
}
