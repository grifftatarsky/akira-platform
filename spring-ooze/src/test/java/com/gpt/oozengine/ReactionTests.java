package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.gpt.oozengine.constant.rules.AmendmentKind;
import com.gpt.oozengine.constant.rules.BattleEventType;
import com.gpt.oozengine.constant.rules.BattlePhase;
import com.gpt.oozengine.model.battle.Battle;
import com.gpt.oozengine.model.battle.BattleEvent;
import com.gpt.oozengine.model.battle.Participant;
import com.gpt.oozengine.model.creature.StatBlock;
import com.gpt.oozengine.model.mechanics.Feature;
import com.gpt.oozengine.service.BattleService;
import jakarta.persistence.EntityManager;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Reactions, and the three things one can do to an action in flight.
 *
 * <p>Counterspell stops it, Shield changes a number, Redirect Attack changes who
 * is being hit. Only the first is a cancellation, which is why the pipeline
 * amends rather than merely permitting or refusing — building the easy case
 * alone would have made the other two unaddable without reshaping it.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@Transactional
class ReactionTests {

  @Autowired private BattleService battles;
  @Autowired private EntityManager em;

  private final UUID dm = UUID.randomUUID();

  private Feature rend() {
    return em.createQuery("""
        select f from Monster m join m.statBlock sb join sb.features f
        where m.ownerId is null and m.name = 'Owlbear' and f.name = 'Rend'
        """, Feature.class).getSingleResult();
  }

  private Participant add(Battle b, String name, int armorClass, int hitPoints) {
    Participant p = new Participant();
    p.setName(name);
    p.setArmorClass(armorClass);
    p.setMaxHitPoints(hitPoints);
    return battles.add(b.getId(), dm, p);
  }

  private Battle fight(long seed) {
    var b = battles.create(dm, "Ford", seed);
    add(b, "Owlbear", 13, 59);
    add(b, "Thalia", 5, 31);
    add(b, "Bram", 18, 40);
    battles.rollInitiative(b.getId(), dm);
    return b;
  }

  private Participant named(Battle b, String name) {
    return b.getParticipants().stream()
        .filter(p -> p.getName().equals(name)).findFirst().orElseThrow();
  }

  private List<BattleEvent> log(Battle b) {
    return b.getEvents().stream()
        .sorted(Comparator.comparingLong(BattleEvent::getSequence)).toList();
  }

  private List<BattleEventType> types(Battle b) {
    return log(b).stream().map(BattleEvent::getType).toList();
  }

  @Test
  @DisplayName("Declaring stops the fight and opens a window")
  void declaringOpensAWindow() {
    var b = fight(31L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");

    battles.declare(b.getId(), dm, owlbear.getId(), rend(), List.of(thalia.getId()));

    // The state a DM sits in: the action exists and has not happened. A window
    // that only lived inside a method call could not be rendered or left.
    assertThat(b.getPhase()).isEqualTo(BattlePhase.AWAITING_REACTION);
    assertThat(b.getPending().isPending()).isTrue();
    assertThat(types(b)).containsSubsequence(
        BattleEventType.ACTION_DECLARED, BattleEventType.REACTION_WINDOW_OPENED);
    assertThat(thalia.getCurrentHitPoints()).isEqualTo(31);
  }

  @Test
  @DisplayName("The window offers everyone who could react, trigger unjudged")
  void windowListsCandidates() {
    var b = fight(32L);
    var owlbear = named(b, "Owlbear");

    var eligible = BattleService.eligibleReactors(b, owlbear);

    // Everyone but the actor, and the engine does not decide whether a Parry
    // that says "hit by a melee attack" applies — it shows the book's words and
    // the DM rules. It will not hide an option on the strength of a regex.
    assertThat(eligible).extracting(Participant::getName)
        .containsExactlyInAnyOrder("Thalia", "Bram");
  }

  @Test
  @DisplayName("Counterspell: the action does not happen at all")
  void cancelStopsIt() {
    var b = fight(33L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");
    battles.declare(b.getId(), dm, owlbear.getId(), rend(), List.of(thalia.getId()));

    battles.react(b.getId(), dm, thalia.getId(), "Counterspell", AmendmentKind.CANCEL,
        null, null, "countered");
    battles.resolvePending(b.getId(), dm, rend(), Map.of());

    assertThat(thalia.getCurrentHitPoints()).isEqualTo(31);
    assertThat(types(b)).contains(BattleEventType.ACTION_CANCELLED);
    // It still bookends: the action was declared and it is over, which is what
    // keeps the log readable and the rewind honest.
    assertThat(types(b)).contains(BattleEventType.ACTION_RESOLVED);
    assertThat(b.getPhase()).isEqualTo(BattlePhase.IN_TURN);
  }

  @Test
  @DisplayName("Shield: the attack happens, against a different number")
  void modifyDefenceRaisesTheTarget() {
    var b = fight(34L);
    var owlbear = named(b, "Owlbear");
    var bram = named(b, "Bram");
    battles.declare(b.getId(), dm, owlbear.getId(), rend(), List.of(bram.getId()));

    battles.react(b.getId(), dm, bram.getId(), "Shield", AmendmentKind.MODIFY_DEFENCE,
        null, 5, "+5 AC against this attack");
    battles.resolvePending(b.getId(), dm, rend(), Map.of());

    var attack = log(b).stream()
        .filter(e -> e.getType() == BattleEventType.ATTACK_ROLLED).findFirst().orElseThrow();
    // "adds 2 to its AC against that attack" — the number to beat moves and the
    // die stays honest in the log.
    assertThat(((Number) attack.getPayload().get("armorClass")).intValue()).isEqualTo(23);
    assertThat(types(b)).contains(BattleEventType.ACTION_AMENDED);
  }

  @Test
  @DisplayName("Redirect Attack: the attack happens, to somebody else")
  void retargetMovesTheAttack() {
    var b = fight(35L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");
    var bram = named(b, "Bram");
    battles.declare(b.getId(), dm, owlbear.getId(), rend(), List.of(thalia.getId()));

    // "The goblin and that ally swap places, and the ally becomes the target of
    // the attack instead." The action still happens — to Bram.
    battles.react(b.getId(), dm, thalia.getId(), "Redirect Attack", AmendmentKind.RETARGET,
        List.of(bram.getId()), null, "swapped places with Bram");
    battles.resolvePending(b.getId(), dm, rend(), Map.of());

    var attack = log(b).stream()
        .filter(e -> e.getType() == BattleEventType.ATTACK_ROLLED).findFirst().orElseThrow();
    assertThat(attack.getParticipantId()).isEqualTo(bram.getId());
    assertThat(thalia.getCurrentHitPoints()).isEqualTo(31);
  }

  @Test
  @DisplayName("Passing resolves the action exactly as declared")
  void proceedChangesNothing() {
    var b = fight(36L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");
    battles.declare(b.getId(), dm, owlbear.getId(), rend(), List.of(thalia.getId()));
    battles.resolvePending(b.getId(), dm, rend(), Map.of());

    assertThat(types(b)).contains(BattleEventType.ATTACK_ROLLED);
    assertThat(b.getPending().isPending()).isFalse();
    assertThat(b.getPhase()).isEqualTo(BattlePhase.IN_TURN);
  }

  @Test
  @DisplayName("A Reaction is spent, and cannot be spent twice")
  void reactionsAreSpent() {
    var b = fight(37L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");
    battles.declare(b.getId(), dm, owlbear.getId(), rend(), List.of(thalia.getId()));

    battles.react(b.getId(), dm, thalia.getId(), "Parry", AmendmentKind.MODIFY_DEFENCE,
        null, 2, null);
    assertThat(thalia.isReactionAvailable()).isFalse();

    // "Once you take a Reaction, you can't take another one until the start of
    // your next turn."
    assertThatThrownBy(() -> battles.react(b.getId(), dm, thalia.getId(), "Parry",
        AmendmentKind.MODIFY_DEFENCE, null, 2, null))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("already taken");
  }

  @Test
  @DisplayName("A second action cannot be declared while one is waiting")
  void oneActionAtATime() {
    var b = fight(38L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");
    battles.declare(b.getId(), dm, owlbear.getId(), rend(), List.of(thalia.getId()));

    assertThatThrownBy(() -> battles.declare(b.getId(), dm, owlbear.getId(), rend(),
        List.of(thalia.getId())))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("already waiting");
  }

  @Test
  @DisplayName("A Shield does not follow the target to the next attack")
  void defenceDiesWithItsAction() {
    var b = fight(39L);
    var owlbear = named(b, "Owlbear");
    var bram = named(b, "Bram");

    battles.declare(b.getId(), dm, owlbear.getId(), rend(), List.of(bram.getId()));
    battles.react(b.getId(), dm, bram.getId(), "Shield", AmendmentKind.MODIFY_DEFENCE,
        null, 5, null);
    battles.resolvePending(b.getId(), dm, rend(), Map.of());

    battles.declare(b.getId(), dm, owlbear.getId(), rend(), List.of(bram.getId()));
    battles.resolvePending(b.getId(), dm, rend(), Map.of());

    var attacks = log(b).stream()
        .filter(e -> e.getType() == BattleEventType.ATTACK_ROLLED)
        .map(e -> ((Number) e.getPayload().get("armorClass")).intValue()).toList();

    // "against that attack" is exactly its lifetime; writing it onto the
    // creature would leave the next attacker facing it too.
    assertThat(attacks).containsExactly(23, 18);
  }

  @Test
  @DisplayName("Rewinding into a window lands in the window")
  void rewindRestoresTheWindow() {
    var b = fight(40L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");
    battles.declare(b.getId(), dm, owlbear.getId(), rend(), List.of(thalia.getId()));
    long window = log(b).getLast().getSequence();

    battles.resolvePending(b.getId(), dm, rend(), Map.of());
    assertThat(b.getPhase()).isEqualTo(BattlePhase.IN_TURN);

    battles.rewindTo(b.getId(), dm, window);

    // A window is a state a DM sits in, so a rewind into one has to land there
    // rather than in the turn that opened it.
    assertThat(b.getPhase()).isEqualTo(BattlePhase.AWAITING_REACTION);
    assertThat(thalia.getCurrentHitPoints()).isEqualTo(31);
  }

  @Test
  @DisplayName("A condition with a stated duration comes off; an open-ended one stays")
  void durationsExpire() {
    var b = fight(41L);
    var thalia = named(b, "Thalia");
    // Applied on Thalia's own turn, so ending it is when a round-scale duration
    // runs out.
    while (BattleService.current(b) != thalia) {
      battles.advance(b.getId(), dm);
    }
    battles.applyCondition(b.getId(), dm, thalia.getId(), "Prone");
    battles.applyCondition(b.getId(), dm, thalia.getId(), "Poisoned");
    // Give the Poisoned one a stated round duration, as the importer does for
    // the 42 effects that carry one.
    log(b).stream()
        .filter(e -> e.getType() == BattleEventType.CONDITION_APPLIED)
        .filter(e -> "Poisoned".equals(e.getPayload().get("condition")))
        .forEach(e -> e.getPayload().put("durationUnit", "ROUND"));

    battles.advance(b.getId(), dm);

    // Before this, nothing ever took a condition off — a Poisoned creature
    // stayed poisoned for the rest of the fight, which is a rules bug that looks
    // like a damage bug three rounds later.
    assertThat(thalia.getConditions()).containsExactly("Prone");
  }
}
