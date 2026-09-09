package com.gpt.oozengine;

import static com.gpt.oozengine.util.Geometry.feet;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.gpt.oozengine.constant.rules.AmendmentKind;
import com.gpt.oozengine.constant.rules.BattleEventType;
import com.gpt.oozengine.constant.rules.BattlePhase;
import com.gpt.oozengine.model.battle.Battle;
import com.gpt.oozengine.model.battle.BattleEvent;
import com.gpt.oozengine.model.battle.Participant;
import com.gpt.oozengine.service.BattleService;
import com.gpt.oozengine.service.MovementLeg;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Moving, as something the battle resolves.
 *
 * <p>The legs arrive already costed, because working out what a square costs
 * needs a board. What is asserted here is the walk: the budget, the stop at the
 * square that provokes, the fall at the end of a step, and the rewind.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@Transactional
class MovementTests {

  @Autowired private BattleService battles;

  private final UUID dm = UUID.randomUUID();

  private Participant add(Battle b, String name, int speed) {
    Participant p = new Participant();
    p.setName(name);
    p.setMaxHitPoints(40);
    p.setArmorClass(13);
    p.setSpeedFeet(speed);
    return battles.add(b.getId(), dm, p);
  }

  private Battle fight(long seed) {
    var b = battles.create(dm, "Field", seed);
    add(b, "Runner", 30);
    add(b, "Ogre", 40);
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

  private static MovementLeg step(int xFeet, int costFeet) {
    return new MovementLeg(feet(xFeet), 0, 0, costFeet, List.of(), 0);
  }

  @Test
  @DisplayName("A move spends the Speed budget and lands where it was told")
  void movingSpendsBudget() {
    var b = fight(61L);
    var runner = named(b, "Runner");
    while (BattleService.current(b) != runner) {
      battles.advance(b.getId(), dm);
    }
    assertThat(runner.getMovementRemainingFeet()).isEqualTo(30);

    battles.move(b.getId(), dm, runner.getId(), List.of(step(5, 5), step(10, 5)));

    assertThat(runner.getX()).isEqualTo(feet(10));
    assertThat(runner.getMovementRemainingFeet()).isEqualTo(20);
    assertThat(log(b)).extracting(BattleEvent::getType).contains(BattleEventType.MOVED);
  }

  @Test
  @DisplayName("A move stops when the budget runs out, and says so")
  void budgetStopsTheMove() {
    var b = fight(62L);
    var runner = named(b, "Runner");
    while (BattleService.current(b) != runner) {
      battles.advance(b.getId(), dm);
    }

    // Four legs of 10 feet against a Speed of 30: the fourth cannot be paid for.
    battles.move(b.getId(), dm, runner.getId(),
        List.of(step(10, 10), step(20, 10), step(30, 10), step(40, 10)));

    assertThat(runner.getX()).isEqualTo(feet(30));
    assertThat(runner.getMovementRemainingFeet()).isZero();
    assertThat(log(b)).anyMatch(e -> e.getSummary().contains("no movement left"));
  }

  @Test
  @DisplayName("The budget refills at the start of the creature's own turn")
  void budgetRefills() {
    var b = fight(63L);
    var runner = named(b, "Runner");
    while (BattleService.current(b) != runner) {
      battles.advance(b.getId(), dm);
    }
    battles.move(b.getId(), dm, runner.getId(), List.of(step(20, 20)));
    assertThat(runner.getMovementRemainingFeet()).isEqualTo(10);

    // Round the order back to the same creature.
    do {
      battles.advance(b.getId(), dm);
    } while (BattleService.current(b) != runner);

    // A Speed is what a creature may spend on its own turn, not a pool that
    // carries.
    assertThat(runner.getMovementRemainingFeet()).isEqualTo(30);
  }

  @Test
  @DisplayName("Leaving a reach stops the move before the step, not after")
  void provokingStopsTheMove() {
    var b = fight(64L);
    var runner = named(b, "Runner");
    var ogre = named(b, "Ogre");
    while (BattleService.current(b) != runner) {
      battles.advance(b.getId(), dm);
    }

    battles.move(b.getId(), dm, runner.getId(), List.of(
        step(5, 5),
        new MovementLeg(feet(10), 0, 0, 5, List.of(ogre.getId()), 0),
        step(20, 5)));

    // "The attack occurs right before the creature leaves your reach" — so the
    // creature is still at the first step, not at the one that provoked.
    assertThat(b.getPhase()).isEqualTo(BattlePhase.AWAITING_REACTION);
    assertThat(runner.getX()).isEqualTo(feet(5));
    assertThat(log(b)).extracting(BattleEvent::getType)
        .contains(BattleEventType.MOVEMENT_PROVOKED);
  }

  @Test
  @DisplayName("Once the reaction has landed, the move carries on")
  void movementResumes() {
    var b = fight(65L);
    var runner = named(b, "Runner");
    var ogre = named(b, "Ogre");
    while (BattleService.current(b) != runner) {
      battles.advance(b.getId(), dm);
    }
    battles.move(b.getId(), dm, runner.getId(), List.of(
        new MovementLeg(feet(10), 0, 0, 10, List.of(ogre.getId()), 0),
        step(20, 10)));

    battles.react(b.getId(), dm, ogre.getId(), "Opportunity Attack",
        AmendmentKind.PROCEED, null, null, "swings as it goes");
    battles.continueMovement(b.getId(), dm);

    // It goes, having been hit at — and the same window does not open again on
    // the step it already provoked.
    assertThat(runner.getX()).isEqualTo(feet(20));
    assertThat(b.getPhase()).isEqualTo(BattlePhase.IN_TURN);
    assertThat(log(b)).filteredOn(e -> e.getType() == BattleEventType.MOVEMENT_PROVOKED)
        .hasSize(1);
  }

  @Test
  @DisplayName("Stepping off a ledge costs falling damage and puts the creature Prone")
  void fallingOffALedge() {
    var b = fight(66L);
    var runner = named(b, "Runner");
    while (BattleService.current(b) != runner) {
      battles.advance(b.getId(), dm);
    }

    battles.move(b.getId(), dm, runner.getId(),
        List.of(new MovementLeg(feet(10), 0, 0, 5, List.of(), 30)));

    // "1d6 for every 10 feet" — 3d6, averaging 10 — "and it has the Prone
    // condition unless it avoids taking any damage".
    assertThat(runner.getCurrentHitPoints()).isEqualTo(30);
    assertThat(runner.getConditions()).contains("Prone");
    assertThat(log(b)).extracting(BattleEvent::getType).contains(BattleEventType.FELL);
  }

  @Test
  @DisplayName("A rewind puts a creature back where it was")
  void rewindRestoresPosition() {
    var b = fight(67L);
    var runner = named(b, "Runner");
    while (BattleService.current(b) != runner) {
      battles.advance(b.getId(), dm);
    }
    long before = log(b).getLast().getSequence();

    battles.move(b.getId(), dm, runner.getId(), List.of(step(25, 25)));
    assertThat(runner.getX()).isEqualTo(feet(25));

    battles.rewindTo(b.getId(), dm, before);

    // Only possible because position lives on the participant. While it lived
    // on the board, a rewind put the hit points back and left the creature
    // standing wherever the undone move had taken it.
    assertThat(runner.getX()).isZero();
    assertThat(runner.getMovementRemainingFeet()).isEqualTo(30);
  }

  @Test
  @DisplayName("Two moves cannot overlap")
  void oneMoveAtATime() {
    var b = fight(68L);
    var runner = named(b, "Runner");
    var ogre = named(b, "Ogre");
    while (BattleService.current(b) != runner) {
      battles.advance(b.getId(), dm);
    }
    battles.move(b.getId(), dm, runner.getId(), List.of(
        new MovementLeg(feet(10), 0, 0, 5, List.of(ogre.getId()), 0)));

    assertThatThrownBy(() -> battles.move(b.getId(), dm, runner.getId(), List.of(step(30, 5))))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("already under way");
  }
}
