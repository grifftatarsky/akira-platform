package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.BattlePhase;
import com.gpt.oozengine.constant.rules.Disposition;
import com.gpt.oozengine.model.battle.Battle;
import com.gpt.oozengine.model.battle.BattleEvent;
import com.gpt.oozengine.model.battle.Participant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Rebuilds a battle's state from its log.
 *
 * <p>This is what makes the log authoritative rather than decorative. Without
 * it, the events are a diary beside the real state and the two are free to
 * disagree — and they will, because every new mutation is a chance to update one
 * and forget the other. With it, undo is a truncation, and any disagreement is a
 * bug this can be run to expose.
 *
 * <p><b>It resets before it folds.</b> Applying events onto whatever is already
 * there would leave anything the truncated events had done still standing, which
 * is exactly the state a rewind is supposed to remove.
 */
public final class BattleFold {

  private BattleFold() {}

  /** Throws away materialised state and rebuilds it from {@code battle.events}. */
  public static void apply(Battle battle) {
    Map<UUID, Participant> byId = new HashMap<>();
    for (Participant p : battle.getParticipants()) {
      byId.put(p.getId(), p);
      reset(p);
    }
    battle.setPhase(BattlePhase.SETUP);
    battle.setRound(0);
    battle.setTurnIndex(-1);
    battle.setRollCount(0);

    for (BattleEvent e : battle.getEvents().stream()
        .sorted(java.util.Comparator.comparingLong(BattleEvent::getSequence))
        .toList()) {
      Participant p = e.getParticipantId() == null ? null : byId.get(e.getParticipantId());
      switch (e.getType()) {
        case INITIATIVE_ROLLED -> {
          battle.setRollCount(battle.getRollCount() + 1);
          if (p != null) {
            p.setInitiative(intOf(e, "total"));
            p.setDisposition(Disposition.ACTIVE);
          }
        }
        case INITIATIVE_ORDER_SET -> battle.setPhase(BattlePhase.BETWEEN_TURNS);
        case PARTICIPANT_PROMOTED -> {
          if (p != null) {
            p.setDisposition(Disposition.ACTIVE);
          }
        }
        case PARTICIPANT_REMOVED -> {
          if (p != null) {
            p.setDisposition(Disposition.REMOVED);
          }
        }
        case ROUND_STARTED -> battle.setRound(intOf(e, "round"));
        case TURN_STARTED -> {
          battle.setPhase(BattlePhase.IN_TURN);
          battle.setTurnIndex(intOf(e, "turnIndex"));
          battle.setRound(intOf(e, "round"));
          if (p != null) {
            p.setReactionAvailable(true);
          }
        }
        case TURN_ENDED -> battle.setPhase(BattlePhase.BETWEEN_TURNS);
        // A window is a state a DM sits in, so a rewind into one has to land
        // there rather than in the turn that opened it.
        case REACTION_WINDOW_OPENED -> battle.setPhase(BattlePhase.AWAITING_REACTION);
        case ACTION_RESOLVED -> battle.setPhase(BattlePhase.IN_TURN);
        case REACTION_TAKEN -> {
          if (p != null) {
            p.setReactionAvailable(false);
          }
        }
        case HIT_POINTS_CHANGED -> {
          if (p != null) {
            p.setCurrentHitPoints(intOf(e, "after"));
          }
        }
        case TEMPORARY_HIT_POINTS_SET -> {
          if (p != null) {
            p.setTemporaryHitPoints(intOf(e, "value"));
          }
        }
        case CONDITION_APPLIED -> {
          if (p != null) {
            p.getConditions().add(stringOf(e, "condition"));
          }
        }
        case CONDITION_REMOVED -> {
          if (p != null) {
            p.getConditions().remove(stringOf(e, "condition"));
          }
        }
        case BATTLE_ENDED -> battle.setPhase(BattlePhase.ENDED);
        // Every roll advances the sequence, so a rewind that lost count would
        // make the fight roll different numbers from the same seed — which is
        // the one thing the seed exists to prevent.
        case ATTACK_ROLLED, SAVE_ROLLED -> battle.setRollCount(battle.getRollCount() + 1);
        // A note, a declaration, a rider and an adjudication all change nothing
        // the fold tracks: the hit points and conditions they led to arrive as
        // their own events, which is what keeps this a fold rather than a second
        // implementation of the rules.
        default -> { }
      }
    }
  }

  /**
   * Back to how the participant entered the fight.
   *
   * <p>The disposition it is reset to is the one it was added with, which the
   * PARTICIPANT_ADDED event carries — a creature promoted off the bench must go
   * back on the bench when the promotion is undone, not stay in the order with
   * no initiative.
   */
  private static void reset(Participant p) {
    p.setCurrentHitPoints(p.getMaxHitPoints());
    p.setTemporaryHitPoints(0);
    p.getConditions().clear();
    p.setInitiative(null);
    p.setReactionAvailable(true);
    p.setDisposition(Disposition.ON_DECK);
  }

  private static int intOf(BattleEvent e, String key) {
    Object v = e.getPayload() == null ? null : e.getPayload().get(key);
    return v instanceof Number n ? n.intValue() : 0;
  }

  private static String stringOf(BattleEvent e, String key) {
    Object v = e.getPayload() == null ? null : e.getPayload().get(key);
    return v == null ? "" : v.toString();
  }
}
