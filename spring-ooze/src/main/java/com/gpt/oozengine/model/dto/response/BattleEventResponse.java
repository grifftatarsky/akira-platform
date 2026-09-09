package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.BattleEventType;
import com.gpt.oozengine.model.battle.BattleEvent;
import java.util.Map;
import java.util.UUID;

/**
 * One line of the log.
 *
 * <p>{@link #sequence} is not decoration — it is what a rewind is addressed to,
 * so the client needs it on every line to offer "undo back to here".
 */
public record BattleEventResponse(
    long sequence,
    BattleEventType type,
    int round,
    UUID participantId,
    Long causedBySequence,
    String summary,
    Map<String, Object> payload) {

  public static BattleEventResponse from(BattleEvent e) {
    return new BattleEventResponse(e.getSequence(), e.getType(), e.getRound(),
        e.getParticipantId(), e.getCausedBySequence(), e.getSummary(),
        e.getPayload() == null ? Map.of() : e.getPayload());
  }
}
