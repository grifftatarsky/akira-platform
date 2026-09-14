package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.gpt.oozengine.constant.rules.BattleEventType;
import com.gpt.oozengine.constant.rules.BattlePhase;
import com.gpt.oozengine.constant.rules.Disposition;
import com.gpt.oozengine.model.battle.Battle;
import com.gpt.oozengine.model.battle.BattleEvent;
import com.gpt.oozengine.model.battle.Participant;
import com.gpt.oozengine.service.BattleService;
import jakarta.persistence.EntityManager;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * The tracker, run as a fight.
 *
 * <p>Seeded throughout, so "the goblin goes first" is a fact about this test
 * rather than something that happens most of the time.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@Transactional
class BattleTests {

  @Autowired private BattleService battles;
  @Autowired private EntityManager em;

  private final UUID dm = UUID.randomUUID();

  private Battle battle() {
    return battles.create(dm, "Ambush", 1234L);
  }

  private Participant add(Battle b, String name, int hp, int bonus) {
    return add(b, name, hp, bonus, Disposition.ACTIVE, false);
  }

  private Participant add(Battle b, String name, int hp, int bonus,
      Disposition disposition, boolean surprised) {
    Participant p = new Participant();
    p.setName(name);
    p.setMaxHitPoints(hp);
    p.setInitiativeBonus(bonus);
    p.setDisposition(disposition);
    p.setSurprised(surprised);
    return battles.add(b.getId(), dm, p);
  }

  private List<BattleEventType> logTypes(Battle b) {
    return b.getEvents().stream()
        .sorted(java.util.Comparator.comparingLong(BattleEvent::getSequence))
        .map(BattleEvent::getType)
        .toList();
  }

  @Nested
  @DisplayName("Initiative")
  class Initiative {

    @Test
    @DisplayName("Everyone in the fight rolls, and the order is highest first")
    void ordersByInitiative() {
      var b = battle();
      add(b, "Owlbear", 59, 1);
      add(b, "Thalia", 31, 3);
      add(b, "Bram", 40, 0);
      battles.rollInitiative(b.getId(), dm);

      var order = BattleService.order(b);
      assertThat(order).hasSize(3);
      assertThat(order).extracting(Participant::getInitiative).isSortedAccordingTo(
          java.util.Comparator.reverseOrder());
    }

    @Test
    @DisplayName("A surprised creature rolls with Disadvantage, and still acts")
    void surpriseIsDisadvantageNotALostTurn() {
      var b = battle();
      var lurker = add(b, "Assassin", 78, 4, Disposition.ACTIVE, true);
      add(b, "Thalia", 31, 3);
      battles.rollInitiative(b.getId(), dm);

      var rolled = b.getEvents().stream()
          .filter(e -> e.getType() == BattleEventType.INITIATIVE_ROLLED)
          .filter(e -> lurker.getId().equals(e.getParticipantId()))
          .findFirst().orElseThrow();

      // Two dice rolled, the lower kept — and the creature is still in the
      // order. The 2014 rule would have removed its whole first turn; the 2024
      // one just makes it likely to go late.
      assertThat((List<?>) rolled.getPayload().get("dice")).hasSize(2);
      assertThat(rolled.getPayload().get("surprised")).isEqualTo(true);
      assertThat(BattleService.order(b)).extracting(Participant::getName).contains("Assassin");
    }

    @Test
    @DisplayName("On-deck creatures do not roll and are not in the order")
    void onDeckStaysOut() {
      var b = battle();
      add(b, "Owlbear", 59, 1);
      add(b, "Reinforcement", 20, 0, Disposition.ON_DECK, false);
      battles.rollInitiative(b.getId(), dm);

      assertThat(BattleService.order(b)).extracting(Participant::getName)
          .containsExactly("Owlbear");
    }

    @Test
    @DisplayName("Rolling twice is refused")
    void rollsOnce() {
      var b = battle();
      add(b, "Owlbear", 59, 1);
      battles.rollInitiative(b.getId(), dm);

      assertThatThrownBy(() -> battles.rollInitiative(b.getId(), dm))
          .isInstanceOf(ResponseStatusException.class)
          .hasMessageContaining("already");
    }

    @Test
    @DisplayName("The same seed rolls the same fight")
    void seedsAreReproducible() {
      var first = battles.create(dm, "A", 99L);
      add(first, "Owlbear", 59, 1);
      battles.rollInitiative(first.getId(), dm);

      var second = battles.create(dm, "B", 99L);
      add(second, "Owlbear", 59, 1);
      battles.rollInitiative(second.getId(), dm);

      // Without this, undo rewinds into a different fight rather than the same
      // one a step earlier.
      assertThat(first.getParticipants().getFirst().getInitiative())
          .isEqualTo(second.getParticipants().getFirst().getInitiative());
    }
  }

  @Nested
  @DisplayName("Turn order")
  class Turns {

    @Test
    @DisplayName("The fight pauses between every turn")
    void pausesBetweenTurns() {
      var b = battle();
      add(b, "Owlbear", 59, 1);
      add(b, "Thalia", 31, 3);
      battles.rollInitiative(b.getId(), dm);

      // rollInitiative advances into the first turn; from there every turn
      // boundary takes two calls, because the pause between them is where a DM
      // takes a reaction or walks somebody in.
      assertThat(b.getPhase()).isEqualTo(BattlePhase.IN_TURN);
      battles.advance(b.getId(), dm);
      assertThat(b.getPhase()).isEqualTo(BattlePhase.BETWEEN_TURNS);
      battles.advance(b.getId(), dm);
      assertThat(b.getPhase()).isEqualTo(BattlePhase.IN_TURN);
    }

    @Test
    @DisplayName("Rounds advance when the order wraps")
    void roundsWrap() {
      var b = battle();
      add(b, "Owlbear", 59, 1);
      add(b, "Thalia", 31, 3);
      battles.rollInitiative(b.getId(), dm);
      assertThat(b.getRound()).isEqualTo(1);

      for (int i = 0; i < 4; i++) {
        battles.advance(b.getId(), dm);
      }
      assertThat(b.getRound()).isEqualTo(2);
      assertThat(logTypes(b)).contains(BattleEventType.ROUND_STARTED);
    }

    @Test
    @DisplayName("A Reaction comes back at the start of the creature's turn")
    void reactionRefreshes() {
      var b = battle();
      var owlbear = add(b, "Owlbear", 59, 1);
      battles.rollInitiative(b.getId(), dm);
      owlbear.setReactionAvailable(false);

      battles.advance(b.getId(), dm);
      battles.advance(b.getId(), dm);

      // "Once you take a Reaction, you can't take another one until the start
      // of your next turn."
      assertThat(owlbear.isReactionAvailable()).isTrue();
    }

    @Test
    @DisplayName("Advancing before Initiative is refused")
    void needsInitiativeFirst() {
      var b = battle();
      add(b, "Owlbear", 59, 1);

      assertThatThrownBy(() -> battles.advance(b.getId(), dm))
          .isInstanceOf(ResponseStatusException.class)
          .hasMessageContaining("Initiative");
    }
  }

  @Nested
  @DisplayName("Walking in mid-fight")
  class OnDeck {

    @Test
    @DisplayName("A promoted creature rolls in and joins the order")
    void promotionRollsIn() {
      var b = battle();
      add(b, "Owlbear", 59, 1);
      add(b, "Thalia", 31, 3);
      var ogre = add(b, "Ogre", 68, -1, Disposition.ON_DECK, false);
      battles.rollInitiative(b.getId(), dm);

      battles.promote(b.getId(), dm, ogre.getId());

      assertThat(ogre.getDisposition()).isEqualTo(Disposition.ACTIVE);
      assertThat(ogre.getInitiative()).isNotNull();
      assertThat(BattleService.order(b)).extracting(Participant::getName).contains("Ogre");
      assertThat(logTypes(b)).contains(BattleEventType.PARTICIPANT_PROMOTED);
    }

    @Test
    @DisplayName("Whoever was acting keeps their turn when the order shifts")
    void promotionDoesNotStealTheTurn() {
      var b = battle();
      add(b, "Owlbear", 59, 1);
      add(b, "Thalia", 31, 3);
      var ogre = add(b, "Ogre", 68, 20, Disposition.ON_DECK, false);
      battles.rollInitiative(b.getId(), dm);
      var acting = BattleService.current(b);

      // The ogre's +20 puts it at the top of the order, which shifts everyone
      // down. A turn index left alone would now point at somebody else.
      battles.promote(b.getId(), dm, ogre.getId());

      assertThat(BattleService.current(b)).isEqualTo(acting);
    }

    @Test
    @DisplayName("Promoting someone already in the fight is refused")
    void promoteOnce() {
      var b = battle();
      var owlbear = add(b, "Owlbear", 59, 1);
      battles.rollInitiative(b.getId(), dm);

      assertThatThrownBy(() -> battles.promote(b.getId(), dm, owlbear.getId()))
          .isInstanceOf(ResponseStatusException.class)
          .hasMessageContaining("already");
    }
  }

  @Nested
  @DisplayName("Bookkeeping")
  class Bookkeeping {

    @Test
    @DisplayName("Damage clamps at zero and healing at the maximum")
    void hitPointsClamp() {
      var b = battle();
      var p = add(b, "Thalia", 31, 3);

      battles.changeHitPoints(b.getId(), dm, p.getId(), -100, "Rend");
      assertThat(p.getCurrentHitPoints()).isZero();
      assertThat(p.isDown()).isTrue();

      battles.changeHitPoints(b.getId(), dm, p.getId(), 500, "Cure Wounds");
      assertThat(p.getCurrentHitPoints()).isEqualTo(31);
    }

    @Test
    @DisplayName("Temporary hit points are spent first, and are not healing")
    void temporaryHitPointsAbsorb() {
      var b = battle();
      var p = add(b, "Bram", 40, 0);
      p.setTemporaryHitPoints(10);

      battles.changeHitPoints(b.getId(), dm, p.getId(), -14, "Bite");

      assertThat(p.getTemporaryHitPoints()).isZero();
      assertThat(p.getCurrentHitPoints()).isEqualTo(36);
    }

    @Test
    @DisplayName("Bloodied is half or fewer, and only while up")
    void bloodied() {
      var b = battle();
      var p = add(b, "Bram", 40, 0);

      battles.changeHitPoints(b.getId(), dm, p.getId(), -20, "Bite");
      assertThat(p.isBloodied()).isTrue();

      battles.changeHitPoints(b.getId(), dm, p.getId(), -20, "Bite");
      assertThat(p.isBloodied()).isFalse();
      assertThat(p.isDown()).isTrue();
    }

    @Test
    @DisplayName("Conditions go on and come off, once each")
    void conditions() {
      var b = battle();
      var p = add(b, "Thalia", 31, 3);

      battles.applyCondition(b.getId(), dm, p.getId(), "Prone");
      battles.applyCondition(b.getId(), dm, p.getId(), "Prone");
      assertThat(p.getConditions()).containsExactly("Prone");
      // The second application changed nothing, so it is not in the log either.
      assertThat(logTypes(b).stream()
          .filter(t -> t == BattleEventType.CONDITION_APPLIED).count()).isEqualTo(1);

      battles.removeCondition(b.getId(), dm, p.getId(), "Prone");
      assertThat(p.getConditions()).isEmpty();
    }
  }

  @Nested
  @DisplayName("The log is the battle")
  class Log {

    @Test
    @DisplayName("Every change leaves a line a DM can read")
    void everythingIsLogged() {
      var b = battle();
      var p = add(b, "Thalia", 31, 3);
      battles.rollInitiative(b.getId(), dm);
      battles.changeHitPoints(b.getId(), dm, p.getId(), -7, "Rend");

      assertThat(logTypes(b)).containsSubsequence(
          BattleEventType.BATTLE_STARTED,
          BattleEventType.PARTICIPANT_ADDED,
          BattleEventType.INITIATIVE_ROLLED,
          BattleEventType.INITIATIVE_ORDER_SET,
          BattleEventType.ROUND_STARTED,
          BattleEventType.TURN_STARTED,
          BattleEventType.HIT_POINTS_CHANGED);
      assertThat(b.getEvents()).allSatisfy(e -> assertThat(e.getSummary()).isNotBlank());
    }

    @Test
    @DisplayName("Sequences are unique and ascending")
    void sequencesAreOrdered() {
      var b = battle();
      add(b, "Thalia", 31, 3);
      battles.rollInitiative(b.getId(), dm);

      var sequences = b.getEvents().stream().map(BattleEvent::getSequence).sorted().toList();
      assertThat(sequences).doesNotHaveDuplicates().isSorted();
    }

    @Test
    @DisplayName("Undo rewinds the fight by truncating the log")
    void undoIsATruncation() {
      var b = battle();
      var p = add(b, "Thalia", 31, 3);
      battles.rollInitiative(b.getId(), dm);
      long before = b.getEvents().stream().mapToLong(BattleEvent::getSequence).max().orElseThrow();

      battles.changeHitPoints(b.getId(), dm, p.getId(), -20, "Rend");
      battles.applyCondition(b.getId(), dm, p.getId(), "Prone");
      assertThat(p.getCurrentHitPoints()).isEqualTo(11);
      assertThat(p.getConditions()).containsExactly("Prone");

      battles.rewindTo(b.getId(), dm, before);

      // The damage and the condition are gone because the events are, not
      // because anything computed an inverse of them.
      assertThat(p.getCurrentHitPoints()).isEqualTo(31);
      assertThat(p.getConditions()).isEmpty();
      assertThat(b.getPhase()).isEqualTo(BattlePhase.IN_TURN);
      assertThat(p.getInitiative()).isNotNull();
    }

    @Test
    @DisplayName("Refolding an untouched battle changes nothing")
    void foldIsAFixedPoint() {
      var b = battle();
      var p = add(b, "Thalia", 31, 3);
      battles.rollInitiative(b.getId(), dm);
      battles.changeHitPoints(b.getId(), dm, p.getId(), -9, "Rend");
      em.flush();

      int hp = p.getCurrentHitPoints();
      int round = b.getRound();
      var phase = b.getPhase();
      long last = b.getEvents().stream().mapToLong(BattleEvent::getSequence).max().orElseThrow();

      battles.rewindTo(b.getId(), dm, last);

      // Folding the whole log has to reproduce exactly what walking it forwards
      // produced. Any drift here is the log and the state disagreeing, which is
      // the failure mode this design exists to make impossible.
      assertThat(p.getCurrentHitPoints()).isEqualTo(hp);
      assertThat(b.getRound()).isEqualTo(round);
      assertThat(b.getPhase()).isEqualTo(phase);
    }
  }

  @Test
  @DisplayName("Another DM's battle is a 404")
  void ownershipIsRowLevel() {
    var b = battle();

    assertThatThrownBy(() -> battles.get(b.getId(), UUID.randomUUID()))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("404");
  }
}
