package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.DiceModifiers;
import com.gpt.oozengine.constant.rules.BattleEventType;
import com.gpt.oozengine.constant.rules.BattlePhase;
import com.gpt.oozengine.constant.rules.Disposition;
import com.gpt.oozengine.model.battle.Battle;
import com.gpt.oozengine.model.battle.BattleEvent;
import com.gpt.oozengine.model.battle.Participant;
import com.gpt.oozengine.model.dto.response.BattleResponse;
import com.gpt.oozengine.model.dto.response.BattleSummaryResponse;
import com.gpt.oozengine.model.dto.response.ParticipantResponse;
import com.gpt.oozengine.repository.BattleRepository;
import com.gpt.oozengine.util.BattleDice;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Running a fight: initiative, turn order, and the pause between turns.
 *
 * <p><b>The engine advances until it needs a decision, then stops.</b> It never
 * runs two turns together, because everything interesting a DM does happens in
 * the gap — a reaction, an environmental effect, an on-deck creature walking in.
 * A tracker that ran straight through would give them nowhere to put any of it.
 *
 * <p><b>Every change is an event first.</b> State on the participants is a fold
 * over the log, materialised so reads are cheap; {@link #rewindTo} throws the
 * materialised state away and refolds, which is why undo is a truncation rather
 * than a pile of inverse operations.
 */
@Service
@RequiredArgsConstructor
public class BattleService {

  private final BattleRepository repo;

  // region Setting up

  @Transactional
  public Battle create(UUID ownerId, String name, Long seed) {
    Battle b = new Battle();
    b.setOwnerId(ownerId);
    b.setName(name);
    // A caller-supplied seed makes a fight reproducible on purpose; otherwise
    // one is chosen and recorded, so it is reproducible anyway.
    b.setSeed(seed == null ? new java.security.SecureRandom().nextLong() : seed);
    repo.save(b);
    append(b, BattleEventType.BATTLE_STARTED, null, "Battle created", Map.of());
    return b;
  }

  @Transactional
  public Participant add(UUID battleId, UUID ownerId, Participant p) {
    Battle b = get(battleId, ownerId);
    if (b.getPhase() == BattlePhase.ENDED) {
      throw conflict("This battle is over");
    }
    p.setCurrentHitPoints(p.getMaxHitPoints());
    b.getParticipants().add(p);
    repo.flush();
    append(b, BattleEventType.PARTICIPANT_ADDED, p.getId(),
        "%s joins (%d HP)".formatted(p.getName(), p.getMaxHitPoints()),
        Map.of("name", p.getName(), "maxHitPoints", p.getMaxHitPoints(),
            "disposition", p.getDisposition().name()));
    return p;
  }

  // endregion

  /**
   * Rolls Initiative for everyone in the fight and fixes the order.
   *
   * <p>Surprise is spent here and nowhere else. From the glossary: "that
   * creature is surprised, which causes it to have Disadvantage on its
   * Initiative roll" — the 2024 rule, so a surprised creature still acts on
   * round one, just probably later. Modelling it as a lost turn, which is the
   * 2014 rule and the one most people reach for, would be wrong by a whole turn
   * of damage for every ambush.
   *
   * <p>On-deck creatures do not roll. They are not in the fight yet, and rolling
   * for them would put them in the order before anybody decided they were there.
   */
  @Transactional
  public Battle rollInitiative(UUID battleId, UUID ownerId) {
    Battle b = get(battleId, ownerId);
    if (b.getPhase() != BattlePhase.SETUP) {
      throw conflict("Initiative has already been rolled");
    }
    b.setPhase(BattlePhase.ROLLING_INITIATIVE);
    inFight(b).forEach(p -> rollInitiativeFor(b, p));

    b.setPhase(BattlePhase.BETWEEN_TURNS);
    b.setRound(0);
    b.setTurnIndex(-1);
    append(b, BattleEventType.INITIATIVE_ORDER_SET, null,
        "Order: " + order(b).stream().map(Participant::getName).toList(),
        Map.of("order", order(b).stream().map(p -> p.getId().toString()).toList()));
    return advance(b);
  }

  private void rollInitiativeFor(Battle b, Participant p) {
    var modifiers = p.isSurprised()
        ? EnumSet.of(DiceModifiers.DISADVANTAGE)
        : EnumSet.noneOf(DiceModifiers.class);
    var roll = dice(b).d20(b.getRollCount(), p.getInitiativeBonus(), modifiers);
    b.setRollCount(b.getRollCount() + 1);
    p.setInitiative(roll.total());
    append(b, BattleEventType.INITIATIVE_ROLLED, p.getId(),
        "%s rolls %d for Initiative%s".formatted(
            p.getName(), roll.total(), p.isSurprised() ? " (surprised, Disadvantage)" : ""),
        Map.of("dice", roll.dice(), "kept", roll.kept(), "bonus", roll.bonus(),
            "total", roll.total(), "surprised", p.isSurprised(),
            "source", roll.source().name()));
  }

  /**
   * Moves the fight on by exactly one step, and stops.
   *
   * <p>From {@link BattlePhase#BETWEEN_TURNS} this opens the next turn; from
   * {@link BattlePhase#IN_TURN} it closes the current one and returns to the
   * pause. Two calls to cross one turn boundary is the point, not an
   * awkwardness: the pause is where a DM acts.
   */
  @Transactional
  public Battle advance(UUID battleId, UUID ownerId) {
    return advance(get(battleId, ownerId));
  }

  private Battle advance(Battle b) {
    switch (b.getPhase()) {
      case SETUP, ROLLING_INITIATIVE ->
          throw conflict("Roll Initiative before advancing");
      case ENDED -> throw conflict("This battle is over");
      case IN_TURN -> endTurn(b);
      case BETWEEN_TURNS -> startNextTurn(b);
      default -> throw new IllegalStateException("Unhandled phase " + b.getPhase());
    }
    repo.flush();
    return b;
  }

  private void endTurn(Battle b) {
    Participant current = atTurnIndex(b);
    b.setPhase(BattlePhase.BETWEEN_TURNS);
    append(b, BattleEventType.TURN_ENDED, current == null ? null : current.getId(),
        current == null ? "Turn ends" : current.getName() + "'s turn ends", Map.of());
  }

  private void startNextTurn(Battle b) {
    List<Participant> order = order(b);
    if (order.isEmpty()) {
      throw conflict("Nobody is in this fight");
    }
    int next = b.getTurnIndex() + 1;
    // Round 0 means the fight has not begun, so the opening turn starts round 1
    // even though it does not wrap. Keying only on the wrap left the first round
    // at zero and never logged that it had started.
    if (next >= order.size() || b.getRound() == 0) {
      next = 0;
      b.setRound(b.getRound() + 1);
      append(b, BattleEventType.ROUND_STARTED, null, "Round " + b.getRound(),
          Map.of("round", b.getRound()));
    }
    b.setTurnIndex(next);
    b.setPhase(BattlePhase.IN_TURN);
    Participant p = order.get(next);
    // "Once you take a Reaction, you can't take another one until the start of
    // your next turn" — so the refresh belongs here, at the start of the turn.
    p.setReactionAvailable(true);
    append(b, BattleEventType.TURN_STARTED, p.getId(),
        "%s's turn (round %d)".formatted(p.getName(), b.getRound()),
        Map.of("round", b.getRound(), "turnIndex", next));
  }

  /**
   * Walks an on-deck creature into the fight, mid-round.
   *
   * <p>The ambush from the balcony, the reinforcements, the ogre waking up on
   * round three — all one mechanism. It rolls Initiative on arrival and takes
   * its place in the order; if that place is earlier than the turn already in
   * progress, it waits until the next round rather than acting twice.
   */
  @Transactional
  public Participant promote(UUID battleId, UUID ownerId, UUID participantId) {
    Battle b = get(battleId, ownerId);
    Participant p = participant(b, participantId);
    if (p.getDisposition() != Disposition.ON_DECK) {
      throw conflict(p.getName() + " is already in the fight");
    }
    Participant acting = atTurnIndex(b);
    p.setDisposition(Disposition.ACTIVE);
    rollInitiativeFor(b, p);
    append(b, BattleEventType.PARTICIPANT_PROMOTED, p.getId(),
        "%s joins the fight on Initiative %d".formatted(p.getName(), p.getInitiative()),
        Map.of("initiative", p.getInitiative()));

    // The order just changed underneath the turn index, so re-find whoever was
    // acting rather than trusting a position that now means someone else.
    if (acting != null) {
      b.setTurnIndex(order(b).indexOf(acting));
    }
    repo.flush();
    return p;
  }

  // region Bookkeeping the tracker does for a DM

  /** Applies damage or healing, clamped, spending temporary hit points first. */
  @Transactional
  public Participant changeHitPoints(UUID battleId, UUID ownerId, UUID participantId,
      int delta, String reason) {
    Battle b = get(battleId, ownerId);
    Participant p = participant(b, participantId);
    int before = p.getCurrentHitPoints();
    int remaining = delta;
    if (delta < 0 && p.getTemporaryHitPoints() > 0) {
      // Temporary hit points are lost before real ones, and are not healing —
      // they do not come back when the creature is healed later.
      int absorbed = Math.min(p.getTemporaryHitPoints(), -delta);
      p.setTemporaryHitPoints(p.getTemporaryHitPoints() - absorbed);
      remaining = delta + absorbed;
    }
    p.setCurrentHitPoints(
        Math.max(0, Math.min(p.getMaxHitPoints(), p.getCurrentHitPoints() + remaining)));
    append(b, BattleEventType.HIT_POINTS_CHANGED, p.getId(),
        "%s %s %d (%d → %d)".formatted(p.getName(), delta < 0 ? "takes" : "regains",
            Math.abs(delta), before, p.getCurrentHitPoints()),
        Map.of("delta", delta, "before", before, "after", p.getCurrentHitPoints(),
            "reason", reason == null ? "" : reason));
    repo.flush();
    return p;
  }

  @Transactional
  public Participant applyCondition(UUID battleId, UUID ownerId, UUID participantId,
      String condition) {
    Battle b = get(battleId, ownerId);
    Participant p = participant(b, participantId);
    if (p.getConditions().add(condition)) {
      append(b, BattleEventType.CONDITION_APPLIED, p.getId(),
          "%s has the %s condition".formatted(p.getName(), condition),
          Map.of("condition", condition));
    }
    repo.flush();
    return p;
  }

  @Transactional
  public Participant removeCondition(UUID battleId, UUID ownerId, UUID participantId,
      String condition) {
    Battle b = get(battleId, ownerId);
    Participant p = participant(b, participantId);
    if (p.getConditions().remove(condition)) {
      append(b, BattleEventType.CONDITION_REMOVED, p.getId(),
          "%s is no longer %s".formatted(p.getName(), condition),
          Map.of("condition", condition));
    }
    repo.flush();
    return p;
  }

  /** A line in the log that changes nothing — what the "to consider" panel reads. */
  @Transactional
  public Battle note(UUID battleId, UUID ownerId, UUID participantId, String text) {
    Battle b = get(battleId, ownerId);
    append(b, BattleEventType.NOTE, participantId, text, Map.of("text", text));
    repo.flush();
    return b;
  }

  @Transactional
  public Battle end(UUID battleId, UUID ownerId) {
    Battle b = get(battleId, ownerId);
    b.setPhase(BattlePhase.ENDED);
    append(b, BattleEventType.BATTLE_ENDED, null, "Battle ends", Map.of());
    repo.flush();
    return b;
  }

  // endregion

  /**
   * Rewinds the fight to just after a given event.
   *
   * <p>Truncate and refold, rather than a set of inverse operations. Inverses
   * are where an event-logged system quietly goes wrong: every new event type
   * needs one, an inverse that is subtly incomplete leaves state nothing can
   * explain, and none of it is visible until a DM notices a hit point total that
   * does not match the log they are reading.
   *
   * <p>Because the dice are derived from the seed and a roll index rather than
   * from a running generator, the rolls after the cut are the same rolls — this
   * is the same fight a step earlier, not a new one.
   */
  @Transactional
  public Battle rewindTo(UUID battleId, UUID ownerId, long sequence) {
    Battle b = get(battleId, ownerId);
    b.getEvents().removeIf(e -> e.getSequence() > sequence);
    repo.flush();
    BattleFold.apply(b);
    repo.flush();
    return b;
  }

  // region Reads

  @Transactional(readOnly = true)
  public org.springframework.data.domain.Page<BattleSummaryResponse> list(
      UUID ownerId, org.springframework.data.domain.Pageable pageable) {
    return repo.findByOwnerId(ownerId, pageable).map(BattleSummaryResponse::from);
  }

  /**
   * Views, mapped inside the transaction.
   *
   * <p>Returning the entity and letting a controller map it reads the log and
   * the participants through lazy proxies after the session has closed.
   */
  @Transactional(readOnly = true)
  public BattleResponse view(UUID id, UUID ownerId) {
    return BattleResponse.from(get(id, ownerId));
  }

  @Transactional
  public BattleResponse createAndView(UUID ownerId, String name, Long seed) {
    return BattleResponse.from(create(ownerId, name, seed));
  }

  @Transactional
  public BattleResponse addAndView(UUID battleId, UUID ownerId, Participant p) {
    add(battleId, ownerId, p);
    return BattleResponse.from(get(battleId, ownerId));
  }

  @Transactional
  public BattleResponse rollInitiativeAndView(UUID battleId, UUID ownerId) {
    return BattleResponse.from(rollInitiative(battleId, ownerId));
  }

  @Transactional
  public BattleResponse advanceAndView(UUID battleId, UUID ownerId) {
    return BattleResponse.from(advance(battleId, ownerId));
  }

  @Transactional
  public BattleResponse promoteAndView(UUID battleId, UUID ownerId, UUID participantId) {
    promote(battleId, ownerId, participantId);
    return BattleResponse.from(get(battleId, ownerId));
  }

  @Transactional
  public BattleResponse rewindAndView(UUID battleId, UUID ownerId, long sequence) {
    return BattleResponse.from(rewindTo(battleId, ownerId, sequence));
  }

  @Transactional
  public ParticipantResponse changeHitPointsAndView(UUID battleId, UUID ownerId,
      UUID participantId, int delta, String reason) {
    return ParticipantResponse.from(
        changeHitPoints(battleId, ownerId, participantId, delta, reason));
  }

  @Transactional
  public ParticipantResponse applyConditionAndView(UUID battleId, UUID ownerId,
      UUID participantId, String condition) {
    return ParticipantResponse.from(applyCondition(battleId, ownerId, participantId, condition));
  }

  @Transactional
  public ParticipantResponse removeConditionAndView(UUID battleId, UUID ownerId,
      UUID participantId, String condition) {
    return ParticipantResponse.from(removeCondition(battleId, ownerId, participantId, condition));
  }

  @Transactional
  public BattleResponse noteAndView(UUID battleId, UUID ownerId, UUID participantId, String text) {
    return BattleResponse.from(note(battleId, ownerId, participantId, text));
  }

  @Transactional
  public BattleResponse endAndView(UUID battleId, UUID ownerId) {
    return BattleResponse.from(end(battleId, ownerId));
  }

  @Transactional(readOnly = true)
  public Battle get(UUID id, UUID ownerId) {
    Battle b = repo.findById(id).orElseThrow(() -> notFound(id));
    if (!b.getOwnerId().equals(ownerId)) {
      throw notFound(id);
    }
    return b;
  }

  /**
   * Whoever's turn it is, or null between turns.
   *
   * <p>Null during the pause on purpose: that is how a client knows to draw the
   * gap rather than leave the last creature highlighted as though it were still
   * acting.
   */
  public static Participant current(Battle b) {
    return b.getPhase() == BattlePhase.IN_TURN ? atTurnIndex(b) : null;
  }

  /**
   * Whoever the turn index points at, whatever the phase.
   *
   * <p>Separate from {@link #current} because the engine needs the position even
   * between turns — promoting a creature there still shifts the order under the
   * index, and using the phase-aware version would silently skip the fix.
   */
  private static Participant atTurnIndex(Battle b) {
    List<Participant> order = order(b);
    int i = b.getTurnIndex();
    return i < 0 || i >= order.size() ? null : order.get(i);
  }

  /**
   * The initiative order: highest first, ties broken without a reroll.
   *
   * <p>Sorted here rather than trusted from the database. A collection ordered
   * by a column is only sorted when it is loaded, and promoting a creature
   * mid-fight changes the order in memory — reading a stale order is how a
   * newcomer gets skipped on the round it arrives.
   */
  public static List<Participant> order(Battle b) {
    List<Participant> out = new ArrayList<>(inFight(b));
    out.sort(Comparator
        .comparing(Participant::getInitiative, Comparator.nullsLast(Comparator.reverseOrder()))
        .thenComparing(Participant::getInitiativeTiebreak, Comparator.reverseOrder())
        .thenComparing(Participant::getId));
    return out;
  }

  private static List<Participant> inFight(Battle b) {
    return b.getParticipants().stream()
        .filter(p -> p.getDisposition() == Disposition.ACTIVE)
        .toList();
  }

  // endregion

  private BattleDice dice(Battle b) {
    return new BattleDice(b.getSeed());
  }

  /** Appends to the log and hands back the sequence, for events that cause others. */
  private long append(Battle b, BattleEventType type, UUID participantId, String summary,
      Map<String, Object> payload) {
    BattleEvent e = new BattleEvent();
    e.setSequence(b.getNextSequence());
    b.setNextSequence(b.getNextSequence() + 1);
    e.setType(type);
    e.setRound(b.getRound());
    e.setParticipantId(participantId);
    e.setSummary(summary);
    e.setPayload(new LinkedHashMap<>(payload));
    b.getEvents().add(e);
    return e.getSequence();
  }

  private static Participant participant(Battle b, UUID id) {
    return b.getParticipants().stream()
        .filter(p -> p.getId().equals(id))
        .findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
            "No participant " + id));
  }

  private static ResponseStatusException notFound(UUID id) {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "No battle " + id);
  }

  private static ResponseStatusException conflict(String message) {
    return new ResponseStatusException(HttpStatus.CONFLICT, message);
  }
}
