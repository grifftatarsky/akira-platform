package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.Disposition;
import com.gpt.oozengine.model.battle.Participant;
import java.util.List;
import java.util.UUID;

/**
 * A creature in the fight, as the tracker shows it.
 *
 * <p>{@link #down} and {@link #bloodied} are computed here rather than left to
 * the client: both are thresholds the rules define, and a client that drew its
 * own line would disagree with the engine about when a trait like Berserk or
 * Loathsome Limbs fires.
 */
public record ParticipantResponse(
    UUID id,
    String name,
    Integer initiative,
    int initiativeBonus,
    boolean surprised,
    int maxHitPoints,
    int currentHitPoints,
    int temporaryHitPoints,
    boolean down,
    boolean bloodied,
    List<String> conditions,
    Disposition disposition,
    boolean reactionAvailable,
    UUID combatantId,
    UUID statBlockId,
    String notes) {

  public static ParticipantResponse from(Participant p) {
    return new ParticipantResponse(p.getId(), p.getName(), p.getInitiative(),
        p.getInitiativeBonus(), p.isSurprised(), p.getMaxHitPoints(), p.getCurrentHitPoints(),
        p.getTemporaryHitPoints(), p.isDown(), p.isBloodied(), List.copyOf(p.getConditions()),
        p.getDisposition(), p.isReactionAvailable(), p.getCombatantId(), p.getStatBlockId(),
        p.getNotes());
  }
}
