package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.DiceModifiers;
import com.gpt.oozengine.constant.rules.AmendmentKind;
import com.gpt.oozengine.constant.rules.BattleEventType;
import com.gpt.oozengine.constant.rules.BattlePhase;
import com.gpt.oozengine.constant.rules.Disposition;
import com.gpt.oozengine.model.battle.Battle;
import com.gpt.oozengine.model.battle.BattleEvent;
import com.gpt.oozengine.model.battle.Participant;
import com.gpt.oozengine.model.mechanics.Feature;
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
    if (current != null) {
      expireConditions(b, current);
    }
    b.setPhase(BattlePhase.BETWEEN_TURNS);
    append(b, BattleEventType.TURN_ENDED, current == null ? null : current.getId(),
        current == null ? "Turn ends" : current.getName() + "'s turn ends", Map.of());
  }

  /**
   * Drops conditions whose time is up.
   *
   * <p>42 of the imported condition effects say how long they last, and before
   * this nothing ever took one off — a Poisoned creature stayed poisoned for the
   * rest of the fight, which is a rules bug that looks like a damage bug three
   * rounds later.
   *
   * <p>Round-scale durations expire at the end of the affected creature's own
   * turn, which is what "until the end of its next turn" means. Longer ones
   * (minutes, hours) outlast any fight the tracker will run, so they are left
   * alone rather than pretended about.
   */
  private void expireConditions(Battle b, Participant p) {
    List<String> expiring = b.getEvents().stream()
        .filter(e -> e.getType() == BattleEventType.CONDITION_APPLIED)
        .filter(e -> p.getId().equals(e.getParticipantId()))
        .filter(e -> "ROUND".equals(String.valueOf(payloadValue(e, "durationUnit"))))
        .filter(e -> e.getRound() < b.getRound()
            || (e.getRound() == b.getRound() && durationOf(e) <= 0))
        .map(e -> String.valueOf(payloadValue(e, "condition")))
        .filter(p.getConditions()::contains)
        .distinct()
        .toList();
    for (String condition : expiring) {
      p.getConditions().remove(condition);
      append(b, BattleEventType.CONDITION_REMOVED, p.getId(),
          "%s is no longer %s".formatted(p.getName(), condition),
          Map.of("condition", condition, "reason", "duration expired"));
    }
  }

  private static Object payloadValue(BattleEvent e, String key) {
    return e.getPayload() == null ? null : e.getPayload().get(key);
  }

  private static int durationOf(BattleEvent e) {
    Object v = payloadValue(e, "durationAmount");
    return v instanceof Number n ? n.intValue() : 0;
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
   * Resolves a feature by the acting creature against some targets.
   *
   * <p>Declared first, then resolved, and both are events. The gap between them
   * is not ceremony — it is where a reaction goes, and an action that both
   * declared and settled itself in one event would leave Counterspell nowhere to
   * land.
   *
   * <p>The resolver is pure and applies nothing; this walks its outcomes, writes
   * each to the log and moves the state. So the numbers are decided in one place
   * that a test can drive without a database, and applied in another that can be
   * replayed.
   */
  @Transactional
  public Battle act(UUID battleId, UUID ownerId, UUID actorId, Feature feature,
      List<UUID> targetIds, Map<UUID, TargetContext> contexts) {
    declare(battleId, ownerId, actorId, feature, targetIds);
    return resolvePending(battleId, ownerId, feature, contexts);
  }

  /**
   * Declares an action and stops, opening a reaction window.
   *
   * <p>The stop is the whole point. Counterspell has to land after "I cast Hold
   * Person" and before the save is rolled, so there must be a state in which the
   * action exists and has not happened — and it has to be a state a client can
   * render and leave, not a moment inside a method call.
   */
  @Transactional
  public Battle declare(UUID battleId, UUID ownerId, UUID actorId, Feature feature,
      List<UUID> targetIds) {
    Battle b = get(battleId, ownerId);
    // The pending check comes first because it is the specific reason. Declaring
    // twice leaves the phase at AWAITING_REACTION, so the phase check would
    // answer "nobody is taking a turn" — which is false, and sends a DM looking
    // at the initiative order for a problem that is in front of them.
    if (b.getPending().isPending()) {
      throw conflict("An action is already waiting to resolve");
    }
    if (b.getPhase() != BattlePhase.IN_TURN) {
      throw conflict("Nobody is taking a turn");
    }
    Participant actor = participant(b, actorId);
    List<Participant> targets = targetIds.stream().map(id -> participant(b, id)).toList();

    long declared = append(b, BattleEventType.ACTION_DECLARED, actor.getId(),
        "%s uses %s%s".formatted(actor.getName(), feature.getName(),
            targets.isEmpty() ? "" : " on " + targets.stream().map(Participant::getName).toList()),
        Map.of("feature", feature.getName(),
            "targets", targets.stream().map(p -> p.getId().toString()).toList()));

    var pending = b.getPending();
    pending.setActorId(actorId);
    pending.setFeatureId(feature.getId());
    pending.setFeatureName(feature.getName());
    pending.setTargetIds(new ArrayList<>(targetIds));
    pending.setDeclaredAt(declared);

    var eligible = eligibleReactors(b, actor);
    b.setPhase(BattlePhase.AWAITING_REACTION);
    appendCaused(b, BattleEventType.REACTION_WINDOW_OPENED, actor.getId(),
        eligible.isEmpty() ? "No reactions available"
            : "Reactions available: " + eligible.stream().map(Participant::getName).toList(),
        Map.of("eligible", eligible.stream().map(p -> p.getId().toString()).toList()),
        declared);
    repo.flush();
    return b;
  }

  /**
   * Who could react right now.
   *
   * <p>Everyone in the fight who has not spent their Reaction, except the
   * creature acting — "you can take a Reaction on another creature's turn".
   *
   * <p><b>Whether their trigger actually matches is not decided here.</b> The
   * engine offers the candidates and shows the book's words; a DM rules on
   * whether a Parry that says "hit by a melee attack" applies to a spell. It
   * will not hide an option on the strength of a regex.
   */
  public static List<Participant> eligibleReactors(Battle b, Participant actor) {
    return order(b).stream()
        .filter(p -> !p.getId().equals(actor.getId()))
        .filter(Participant::isReactionAvailable)
        .filter(p -> !p.isDown())
        .toList();
  }

  /**
   * Takes a reaction, and says what it does to the action in flight.
   *
   * <p>Three verbs, not one. Cancelling is the easy case and the misleading one:
   * Shield amends a number and Redirect Attack amends who is being hit, and
   * neither stops the action.
   */
  @Transactional
  public Battle react(UUID battleId, UUID ownerId, UUID reactorId, String reactionName,
      AmendmentKind kind, List<UUID> newTargetIds, Integer armorClassDelta, String reason) {
    Battle b = get(battleId, ownerId);
    if (b.getPhase() != BattlePhase.AWAITING_REACTION) {
      throw conflict("No action is waiting on a reaction");
    }
    Participant reactor = participant(b, reactorId);
    if (!reactor.isReactionAvailable()) {
      // "Once you take a Reaction, you can't take another one until the start of
      // your next turn."
      throw conflict(reactor.getName() + " has already taken a Reaction");
    }
    reactor.setReactionAvailable(false);
    var pending = b.getPending();
    long declared = pending.getDeclaredAt() == null ? 0 : pending.getDeclaredAt();

    appendCaused(b, BattleEventType.REACTION_TAKEN, reactor.getId(),
        "%s reacts with %s".formatted(reactor.getName(), reactionName),
        Map.of("reaction", reactionName, "kind", kind.name(),
            "reason", reason == null ? "" : reason),
        declared);

    switch (kind) {
      case CANCEL -> {
        pending.setCancelled(true);
        appendCaused(b, BattleEventType.ACTION_CANCELLED, reactor.getId(),
            "%s is countered".formatted(pending.getFeatureName()),
            Map.of("by", reactor.getName()), declared);
      }
      case RETARGET -> {
        // "The goblin and that ally swap places, and the ally becomes the target
        // of the attack instead." The action still happens, to somebody else.
        pending.setTargetIds(new ArrayList<>(newTargetIds == null ? List.of() : newTargetIds));
        appendCaused(b, BattleEventType.ACTION_AMENDED, reactor.getId(),
            "%s now targets %s".formatted(pending.getFeatureName(),
                pending.getTargetIds().stream()
                    .map(id -> participant(b, id).getName()).toList()),
            Map.of("targets", pending.getTargetIds().stream().map(UUID::toString).toList()),
            declared);
      }
      case MODIFY_DEFENCE -> {
        int delta = armorClassDelta == null ? 0 : armorClassDelta;
        pending.setArmorClassDelta(
            (pending.getArmorClassDelta() == null ? 0 : pending.getArmorClassDelta()) + delta);
        appendCaused(b, BattleEventType.ACTION_AMENDED, reactor.getId(),
            "%s adds %d to AC against this attack".formatted(reactor.getName(), delta),
            Map.of("armorClassDelta", pending.getArmorClassDelta()), declared);
      }
      case PROCEED -> { }
      default -> throw new IllegalStateException("Unhandled amendment " + kind);
    }
    repo.flush();
    return b;
  }

  /**
   * Closes the window and resolves whatever is left of the action.
   *
   * <p>Reads the pending action rather than the declared one, so a retarget
   * lands on the new creature and a cancellation resolves nothing at all.
   */
  @Transactional
  public Battle resolvePending(UUID battleId, UUID ownerId, Feature feature,
      Map<UUID, TargetContext> contexts) {
    Battle b = get(battleId, ownerId);
    var pending = b.getPending();
    if (!pending.isPending()) {
      throw conflict("No action is waiting to resolve");
    }
    Participant actor = participant(b, pending.getActorId());
    long declared = pending.getDeclaredAt() == null ? 0 : pending.getDeclaredAt();

    if (!pending.wasCancelled()) {
      List<Participant> targets = pending.getTargetIds() == null ? List.of()
          : pending.getTargetIds().stream().map(id -> participant(b, id)).toList();
      var resolution = ActionResolver.resolve(actor, feature, targets,
          withDefence(contexts, pending.getArmorClassDelta(), targets),
          dice(b), b.getRollCount());
      b.setRollCount(b.getRollCount() + resolution.rollsUsed());
      for (var outcome : resolution.outcomes()) {
        applyOutcome(b, outcome, declared);
      }
    }
    append(b, BattleEventType.ACTION_RESOLVED, actor.getId(),
        pending.wasCancelled()
            ? "%s does not happen".formatted(pending.getFeatureName())
            : "%s finishes %s".formatted(actor.getName(), pending.getFeatureName()),
        Map.of("feature", pending.getFeatureName(), "declaredAt", declared,
            "cancelled", pending.wasCancelled()));
    pending.clear();
    b.setPhase(BattlePhase.IN_TURN);
    repo.flush();
    return b;
  }

  /**
   * Folds a Shield-style amendment into the cover the board already reported.
   *
   * <p>It rides on the target context rather than on the participant, because
   * that is exactly its lifetime — "against that attack". Writing it onto the
   * creature would leave the next attacker facing it too.
   */
  private static Map<UUID, TargetContext> withDefence(Map<UUID, TargetContext> contexts,
      Integer delta, List<Participant> targets) {
    Map<UUID, TargetContext> out = new LinkedHashMap<>(contexts == null ? Map.of() : contexts);
    if (delta == null || delta == 0) {
      return out;
    }
    for (Participant t : targets) {
      var base = out.getOrDefault(t.getId(), TargetContext.open(t.getId()));
      out.put(t.getId(), new TargetContext(t.getId(),
          base.coverArmorClassBonus() + delta, base.totalCover(), base.inRange(),
          base.hasLineOfSight()));
    }
    return out;
  }

  /** One outcome, logged and applied. Every branch does both or neither. */
  private void applyOutcome(Battle b, ActionResolver.Outcome outcome, long causedBy) {
    UUID targetId = outcome.targetId();
    Participant target = targetId == null ? null : findParticipant(b, targetId);
    switch (outcome) {
      case ActionResolver.AttackRoll r -> appendCaused(b, BattleEventType.ATTACK_ROLLED, targetId,
          r.summary(), r.payload(), causedBy);
      case ActionResolver.SavingThrow r -> appendCaused(b, BattleEventType.SAVE_ROLLED, targetId,
          r.summary(), r.payload(), causedBy);
      case ActionResolver.Damage d -> {
        if (target != null) {
          applyHitPoints(b, target, -d.afterResponse(), d.summary(), d.payload(), causedBy);
        }
      }
      case ActionResolver.Healing h -> {
        if (target != null) {
          applyHitPoints(b, target, h.amount(), h.summary(), h.payload(), causedBy);
        }
      }
      case ActionResolver.TemporaryHitPoints t -> {
        if (target != null) {
          // "Temporary Hit Points don't stack: take the higher" — so this is a
          // max rather than a sum, and the event records the value it settled on
          // so the fold does not have to redo the comparison.
          int value = Math.max(target.getTemporaryHitPoints(), t.amount());
          target.setTemporaryHitPoints(value);
          appendCaused(b, BattleEventType.TEMPORARY_HIT_POINTS_SET, targetId, t.summary(),
              Map.of("value", value, "offered", t.amount()), causedBy);
        }
      }
      case ActionResolver.ConditionApplied c -> {
        if (target != null && !c.condition().isBlank() && target.getConditions().add(c.condition())) {
          appendCaused(b, BattleEventType.CONDITION_APPLIED, targetId, c.summary(), c.payload(),
              causedBy);
        }
      }
      case ActionResolver.RiderApplied r -> appendCaused(b, BattleEventType.RIDER_APPLIED, targetId,
          r.summary(), r.payload(), causedBy);
      case ActionResolver.Moved m -> appendCaused(b, BattleEventType.NOTE, targetId, m.summary(),
          m.payload(), causedBy);
      case ActionResolver.Information i -> appendCaused(b, BattleEventType.NOTE, targetId,
          i.summary(), i.payload(), causedBy);
      case ActionResolver.NeedsAdjudication a -> appendCaused(b, BattleEventType.ADJUDICATED,
          targetId, a.summary(), a.payload(), causedBy);
    }
  }

  /** Damage and healing share one path, so temporary hit points cannot be skipped. */
  private void applyHitPoints(Battle b, Participant p, int delta, String summary,
      Map<String, Object> payload, long causedBy) {
    int before = p.getCurrentHitPoints();
    int remaining = delta;
    if (delta < 0 && p.getTemporaryHitPoints() > 0) {
      int absorbed = Math.min(p.getTemporaryHitPoints(), -delta);
      p.setTemporaryHitPoints(p.getTemporaryHitPoints() - absorbed);
      remaining = delta + absorbed;
    }
    p.setCurrentHitPoints(
        Math.max(0, Math.min(p.getMaxHitPoints(), p.getCurrentHitPoints() + remaining)));
    Map<String, Object> full = new LinkedHashMap<>(payload);
    full.put("before", before);
    full.put("after", p.getCurrentHitPoints());
    full.put("delta", delta);
    appendCaused(b, BattleEventType.HIT_POINTS_CHANGED, p.getId(), summary, full, causedBy);
  }

  private static Participant findParticipant(Battle b, UUID id) {
    return b.getParticipants().stream().filter(p -> p.getId().equals(id)).findFirst().orElse(null);
  }

  private void appendCaused(Battle b, BattleEventType type, UUID participantId, String summary,
      Map<String, Object> payload, long causedBy) {
    long seq = append(b, type, participantId, summary, payload);
    b.getEvents().stream()
        .filter(e -> e.getSequence() == seq)
        .findFirst()
        // Pointing back at the declaration is what lets the log show a hit as an
        // answer to an action rather than as an unrelated thing that happened
        // next — and it is what a reaction will hang off in phase 5.
        .ifPresent(e -> e.setCausedBySequence(causedBy));
  }

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
  public BattleResponse reactAndView(UUID battleId, UUID ownerId, UUID reactorId,
      String reactionName, AmendmentKind kind, List<UUID> newTargetIds, Integer armorClassDelta,
      String reason) {
    react(battleId, ownerId, reactorId, reactionName, kind, newTargetIds, armorClassDelta, reason);
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
