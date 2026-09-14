package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.gpt.oozengine.constant.rules.BattleEventType;
import com.gpt.oozengine.constant.rules.DamageResponseKind;
import com.gpt.oozengine.constant.rules.DamageType;
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
 * A real creature attacking a real target, through the log.
 *
 * <p>The resolver's own rules are tested without a database elsewhere; what is
 * asserted here is that the outcomes reach the log and the state, that they
 * point back at the action that caused them, and that a rewind takes them away
 * again.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@Transactional
class BattleActionTests {

  @Autowired private BattleService battles;
  @Autowired private EntityManager em;

  private final UUID dm = UUID.randomUUID();

  private StatBlock statBlockOf(String monster) {
    return em.createQuery(
            "select m.statBlock from Monster m where m.ownerId is null and m.name = :n",
            StatBlock.class)
        .setParameter("n", monster).getSingleResult();
  }

  private Feature featureOf(String monster, String feature) {
    return statBlockOf(monster).getFeatures().stream()
        .filter(f -> f.getName().equals(feature))
        .findFirst().orElseThrow(() -> new AssertionError(monster + " has no " + feature));
  }

  private Participant add(Battle b, String name, int armorClass, int hitPoints) {
    Participant p = new Participant();
    p.setName(name);
    p.setArmorClass(armorClass);
    p.setMaxHitPoints(hitPoints);
    return battles.add(b.getId(), dm, p);
  }

  /** A battle with two participants, already on somebody's turn. */
  private Battle fight(long seed) {
    var b = battles.create(dm, "Ford", seed);
    add(b, "Owlbear", 13, 59);
    add(b, "Thalia", 5, 31);
    battles.rollInitiative(b.getId(), dm);
    return b;
  }

  private List<BattleEvent> log(Battle b) {
    return b.getEvents().stream()
        .sorted(Comparator.comparingLong(BattleEvent::getSequence)).toList();
  }

  private Participant named(Battle b, String name) {
    return b.getParticipants().stream()
        .filter(p -> p.getName().equals(name)).findFirst().orElseThrow();
  }

  @Test
  @DisplayName("An Owlbear's Rend reaches the log and the hit points")
  void rendResolves() {
    var b = fight(11L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");

    battles.act(b.getId(), dm, owlbear.getId(), featureOf("Owlbear", "Rend"),
        List.of(thalia.getId()), Map.of());

    var types = log(b).stream().map(BattleEvent::getType).toList();
    assertThat(types).containsSubsequence(
        BattleEventType.ACTION_DECLARED,
        BattleEventType.ATTACK_ROLLED,
        BattleEventType.ACTION_RESOLVED);

    // The invariant rather than a lucky roll: damage lands exactly when the
    // attack hit. Asserting "hit points went down" would pass on most seeds and
    // fail on the one in twenty that rolls a natural 1, which is a flake rather
    // than a finding.
    var attack = log(b).stream()
        .filter(e -> e.getType() == BattleEventType.ATTACK_ROLLED).findFirst().orElseThrow();
    boolean hit = Boolean.TRUE.equals(attack.getPayload().get("hit"));
    assertThat(thalia.getCurrentHitPoints() < 31).isEqualTo(hit);
    assertThat(log(b)).filteredOn(e -> e.getType() == BattleEventType.HIT_POINTS_CHANGED)
        .hasSize(hit ? 1 : 0);
  }

  @Test
  @DisplayName("Declaration and resolution are separate, with the gap in between")
  void declarationPrecedesResolution() {
    var b = fight(12L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");

    battles.act(b.getId(), dm, owlbear.getId(), featureOf("Owlbear", "Rend"),
        List.of(thalia.getId()), Map.of());

    var declared = log(b).stream()
        .filter(e -> e.getType() == BattleEventType.ACTION_DECLARED).findFirst().orElseThrow();
    var attack = log(b).stream()
        .filter(e -> e.getType() == BattleEventType.ATTACK_ROLLED).findFirst().orElseThrow();

    // The gap is where Counterspell lands in phase 5, and causedBySequence is
    // what will hang it off the right action rather than off whatever happened
    // to be previous.
    assertThat(attack.getSequence()).isGreaterThan(declared.getSequence());
    assertThat(attack.getCausedBySequence()).isEqualTo(declared.getSequence());
  }

  @Test
  @DisplayName("A resistance halves what lands, and the log keeps both numbers")
  void resistanceApplies() {
    var b = fight(13L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");
    thalia.getDamageResponses().put(DamageType.SLASHING, DamageResponseKind.RESISTANCE);

    battles.act(b.getId(), dm, owlbear.getId(), featureOf("Owlbear", "Rend"),
        List.of(thalia.getId()), Map.of());

    var damage = log(b).stream()
        .filter(e -> e.getType() == BattleEventType.HIT_POINTS_CHANGED)
        .findFirst().orElseThrow();
    int rolled = ((Number) damage.getPayload().get("rolled")).intValue();
    int applied = ((Number) damage.getPayload().get("applied")).intValue();

    // A log that kept only the applied number cannot show a DM why one became
    // the other, which is the moment they most want to check the engine.
    assertThat(applied).isEqualTo(rolled / 2);
  }

  @Test
  @DisplayName("Rewinding after an attack puts the hit points back")
  void rewindUndoesAnAction() {
    var b = fight(14L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");
    long before = log(b).getLast().getSequence();

    battles.act(b.getId(), dm, owlbear.getId(), featureOf("Owlbear", "Rend"),
        List.of(thalia.getId()), Map.of());
    assertThat(thalia.getCurrentHitPoints()).isLessThan(31);

    battles.rewindTo(b.getId(), dm, before);

    // The damage is gone because the events are, not because anything computed
    // an inverse of an attack.
    assertThat(thalia.getCurrentHitPoints()).isEqualTo(31);
  }

  @Test
  @DisplayName("A rewound fight re-rolls the same numbers")
  void rewindKeepsTheSameFight() {
    var b = fight(15L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");
    long before = log(b).getLast().getSequence();
    var rend = featureOf("Owlbear", "Rend");

    battles.act(b.getId(), dm, owlbear.getId(), rend, List.of(thalia.getId()), Map.of());
    int first = thalia.getCurrentHitPoints();

    battles.rewindTo(b.getId(), dm, before);
    battles.act(b.getId(), dm, owlbear.getId(), rend, List.of(thalia.getId()), Map.of());

    // The fold restores the roll count, so the same seed reaches the same index
    // and rolls the same die. Without that, undo would rewind into a different
    // fight rather than the same one a step earlier.
    assertThat(thalia.getCurrentHitPoints()).isEqualTo(first);
  }

  @Test
  @DisplayName("A prose feature is adjudicated, and still lands in the log")
  void proseGoesToTheDungeonMaster() {
    var b = fight(16L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");

    battles.act(b.getId(), dm, owlbear.getId(), featureOf("Oni", "Shape-Shift"),
        List.of(thalia.getId()), Map.of());

    assertThat(log(b)).extracting(BattleEvent::getType)
        .contains(BattleEventType.ADJUDICATED);
    // It still spends the action and still bookends properly, so from the log's
    // side it looks exactly like a resolved one.
    assertThat(log(b)).extracting(BattleEvent::getType)
        .containsSubsequence(BattleEventType.ACTION_DECLARED, BattleEventType.ADJUDICATED,
            BattleEventType.ACTION_RESOLVED);
  }

  @Test
  @DisplayName("Acting between turns is refused")
  void actingNeedsATurn() {
    var b = fight(17L);
    var owlbear = named(b, "Owlbear");
    var thalia = named(b, "Thalia");
    battles.advance(b.getId(), dm);

    assertThatThrownBy(() -> battles.act(b.getId(), dm, owlbear.getId(),
        featureOf("Owlbear", "Rend"), List.of(thalia.getId()), Map.of()))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("turn");
  }
}
