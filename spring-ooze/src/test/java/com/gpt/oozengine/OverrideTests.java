package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static com.gpt.oozengine.util.Geometry.feet;

import com.gpt.oozengine.constant.rules.Capability;
import com.gpt.oozengine.constant.rules.ComponentMode;
import com.gpt.oozengine.constant.rules.RiderMode;
import com.gpt.oozengine.model.creature.StatBlock;
import com.gpt.oozengine.model.encounter.BattleMap;
import com.gpt.oozengine.model.encounter.Combatant;
import com.gpt.oozengine.model.encounter.Scaling;
import com.gpt.oozengine.model.mechanics.Feature;
import com.gpt.oozengine.service.EncounterLaunchService;
import com.gpt.oozengine.service.EncounterService;
import com.gpt.oozengine.service.NpcFactory;
import com.gpt.oozengine.service.StatBlockCloner;
import jakarta.persistence.EntityManager;
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
 * A DM's changes to a creature, and the compendium surviving them.
 *
 * <p>The claim under test is the one the whole design rests on: the SRD row is
 * never copied to play, and when it is copied for surgery, the copy is deep
 * enough to be a different creature.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@Transactional
class OverrideTests {

  @Autowired private EncounterService encounters;
  @Autowired private EncounterLaunchService launches;
  @Autowired private EntityManager em;

  private final UUID dm = UUID.randomUUID();

  private StatBlock statBlockOf(String monster) {
    return em.createQuery(
            "select m.statBlock from Monster m where m.ownerId is null and m.name = :n",
            StatBlock.class)
        .setParameter("n", monster).getSingleResult();
  }

  private Combatant place(UUID encounterId, String monster, int xFeet) {
    Combatant c = new Combatant();
    c.setStatBlock(statBlockOf(monster));
    c.setName(monster);
    c.setX(feet(xFeet));
    return encounters.place(encounterId, dm, c);
  }

  @Nested
  @DisplayName("Scaling")
  class Scale {

    @Test
    @DisplayName("A dialled-up creature is tougher at launch, and the book is not")
    void scalingAppliesAtLaunch() {
      var e = encounters.create(dm, "Tougher", new BattleMap());
      var owlbear = place(e.getId(), "Owlbear", 10);
      int printed = owlbear.getStatBlock().getHitPoints().getAverage();

      encounters.scale(e.getId(), dm, owlbear.getId(),
          new Scaling(150, 2, 100, 0, 0));
      var battle = launches.launch(e.getId(), dm, "Run one", 1L);

      assertThat(printed).isEqualTo(59);
      assertThat(battle.order().getFirst().maxHitPoints()).isEqualTo(89);
      // Nothing was written back, so the compendium row is untouched.
      assertThat(statBlockOf("Owlbear").getHitPoints().getAverage()).isEqualTo(59);
    }

    @Test
    @DisplayName("Scaling can be dialled back down, because it was never baked")
    void scalingIsReversible() {
      var e = encounters.create(dm, "Tunable", new BattleMap());
      var owlbear = place(e.getId(), "Owlbear", 10);

      encounters.scale(e.getId(), dm, owlbear.getId(), new Scaling(200, 0, 100, 0, 0));
      assertThat(launches.launch(e.getId(), dm, "Hard", 1L)
          .order().getFirst().maxHitPoints()).isEqualTo(118);

      encounters.scale(e.getId(), dm, owlbear.getId(), new Scaling());
      // A cloned block with 118 written over 59 could not have got back here,
      // because nothing would know whether 118 was a scale or a hand edit.
      assertThat(launches.launch(e.getId(), dm, "Normal", 1L)
          .order().getFirst().maxHitPoints()).isEqualTo(59);
    }

    @Test
    @DisplayName("A hand-set total is exact and is not scaled again")
    void explicitHitPointsWin() {
      var e = encounters.create(dm, "Exact", new BattleMap());
      var owlbear = place(e.getId(), "Owlbear", 10);
      owlbear.setMaxHitPoints(40);
      encounters.scale(e.getId(), dm, owlbear.getId(), new Scaling(150, 0, 100, 0, 0));

      // A DM who typed 40 meant 40, not 60.
      assertThat(launches.launch(e.getId(), dm, "Run", 1L)
          .order().getFirst().maxHitPoints()).isEqualTo(40);
    }

    @Test
    @DisplayName("Scaling rounds rather than truncating, and never reaches zero")
    void scalingArithmetic() {
      assertThat(Scaling.percentOf(7, 150)).isEqualTo(11);
      // A creature scaled to a tenth of nothing is still a creature.
      assertThat(Scaling.percentOf(3, 1)).isEqualTo(1);
    }
  }

  @Nested
  @DisplayName("Surgery")
  class Surgery {

    @Test
    @DisplayName("Nothing is cloned until a DM actually changes the creature")
    void copyOnWriteIsLazy() {
      var e = encounters.create(dm, "Goblins", new BattleMap());
      var a = place(e.getId(), "Goblin Warrior", 10);
      var b = place(e.getId(), "Goblin Warrior", 30);

      // Forty goblins is one shared row, not forty copies of it.
      assertThat(a.isOverridden()).isFalse();
      assertThat(a.effectiveStatBlock()).isSameAs(b.effectiveStatBlock());
    }

    @Test
    @DisplayName("Editing the override leaves the compendium creature alone")
    void overrideIsIsolated() {
      var e = encounters.create(dm, "Boss fight", new BattleMap());
      var goblin = place(e.getId(), "Goblin Warrior", 10);

      var mine = encounters.beginOverride(e.getId(), dm, goblin.getId());
      mine.setArmorClass(99);
      mine.getFeatures().getFirst().setName("Wicked Scimitar");
      em.flush();
      em.clear();

      var book = statBlockOf("Goblin Warrior");
      assertThat(book.getArmorClass()).isNotEqualTo(99);
      assertThat(book.getFeatures()).extracting(Feature::getName)
          .doesNotContain("Wicked Scimitar");
    }

    @Test
    @DisplayName("Asking twice returns the copy that already exists")
    void overrideIsIdempotent() {
      var e = encounters.create(dm, "Twice", new BattleMap());
      var goblin = place(e.getId(), "Goblin Warrior", 10);

      var first = encounters.beginOverride(e.getId(), dm, goblin.getId());
      first.setArmorClass(42);
      var second = encounters.beginOverride(e.getId(), dm, goblin.getId());

      // A second clone would have silently lost the first edit.
      assertThat(second.getId()).isEqualTo(first.getId());
      assertThat(second.getArmorClass()).isEqualTo(42);
    }

    @Test
    @DisplayName("Reverting goes back to the book and deletes the copy")
    void revertRemovesTheClone() {
      var e = encounters.create(dm, "Undo", new BattleMap());
      var goblin = place(e.getId(), "Goblin Warrior", 10);
      var mine = encounters.beginOverride(e.getId(), dm, goblin.getId());
      UUID cloneId = mine.getId();
      em.flush();

      encounters.revertOverride(e.getId(), dm, goblin.getId());
      em.flush();

      assertThat(goblin.isOverridden()).isFalse();
      // orphanRemoval does the deleting, so reverting cannot leave a row that
      // nothing points at and nobody will ever find.
      assertThat(em.find(StatBlock.class, cloneId)).isNull();
    }

    @Test
    @DisplayName("A combatant with no stat block cannot be operated on")
    void nothingToOverride() {
      var e = encounters.create(dm, "Empty", new BattleMap());
      Combatant c = new Combatant();
      c.setStatBlock(statBlockOf("Owlbear"));
      var placed = encounters.place(e.getId(), dm, c);
      placed.setStatBlock(null);

      assertThatThrownBy(() -> encounters.beginOverride(e.getId(), dm, placed.getId()))
          .isInstanceOf(ResponseStatusException.class)
          .hasMessageContaining("no stat block");
    }

    @Test
    @DisplayName("An overridden creature fights with its own numbers")
    void overrideReachesTheBattle() {
      var e = encounters.create(dm, "Boss", new BattleMap());
      var goblin = place(e.getId(), "Goblin Warrior", 10);
      var mine = encounters.beginOverride(e.getId(), dm, goblin.getId());
      mine.getHitPoints().setAverage(200);

      assertThat(launches.launch(e.getId(), dm, "Run", 1L)
          .order().getFirst().maxHitPoints()).isEqualTo(200);
    }
  }

  @Nested
  @DisplayName("The clone is deep enough to be a different creature")
  class Depth {

    @Test
    @DisplayName("Features, steps, effects and riders all come along")
    void wholeTreeIsCopied() {
      // The Aboleth rather than the Owlbear: it has Legendary Resistance, so
      // there are riders to lose. A creature with none proves nothing here.
      var base = statBlockOf("Aboleth");
      var copy = StatBlockCloner.deepCopy(base);

      assertThat(copy.getFeatures()).hasSameSizeAs(base.getFeatures());
      // A clone that dropped riders would be a copy of a creature that has
      // quietly lost Pack Tactics.
      long baseRiders = base.getFeatures().stream()
          .flatMap(f -> f.getSteps().stream()).flatMap(s -> s.getEffects().stream())
          .mapToLong(x -> x.getRiders().size()).sum();
      long copyRiders = copy.getFeatures().stream()
          .flatMap(f -> f.getSteps().stream()).flatMap(s -> s.getEffects().stream())
          .mapToLong(x -> x.getRiders().size()).sum();
      assertThat(copyRiders).isEqualTo(baseRiders).isPositive();
    }

    @Test
    @DisplayName("A Multiattack in the copy invokes the copy's own attacks")
    void componentsAreRemapped() {
      var base = statBlockOf("Aboleth");
      var copy = StatBlockCloner.deepCopy(base);

      var multiattack = copy.getFeatures().stream()
          .filter(f -> f.getName().startsWith("Multiattack"))
          .findFirst().orElseThrow();
      assertThat(multiattack.getComponents()).isNotEmpty();

      // Copying the reference verbatim would leave the override's Multiattack
      // invoking the *book's* Tentacle, so editing the attack would change
      // nothing — the bug that is hardest to see and easiest to write.
      for (var component : multiattack.getComponents()) {
        if (component.getReferencedFeature() != null) {
          assertThat(copy.getFeatures()).contains(component.getReferencedFeature());
          assertThat(base.getFeatures()).doesNotContain(component.getReferencedFeature());
        }
      }
      assertThat(multiattack.getComponents())
          .extracting(c -> c.getMode())
          .doesNotContainNull()
          .allMatch(m -> m instanceof ComponentMode);
    }

    @Test
    @DisplayName("Capabilities survive, so a swarm stays allowed to share a square")
    void capabilitiesSurvive() {
      var copy = StatBlockCloner.deepCopy(statBlockOf("Swarm of Rats"));

      assertThat(copy.getFeatures())
          .flatExtracting(f -> f.getCapabilities().stream().map(c -> c.getCapability()).toList())
          .contains(Capability.OCCUPY_CREATURE_SPACE);
    }

    @Test
    @DisplayName("Legendary Resistance survives, riders and all")
    void ridersSurvive() {
      var copy = StatBlockCloner.deepCopy(statBlockOf("Aboleth"));

      assertThat(copy.getFeatures())
          .flatExtracting(f -> f.getSteps())
          .flatExtracting(s -> s.getEffects())
          .flatExtracting(x -> x.getRiders())
          .extracting(r -> r.getMode())
          .contains(RiderMode.AUTO_SUCCEED);
    }

    @Test
    @DisplayName("Shared catalog rows are shared, not cloned")
    void referencesAreNotCopied() {
      var base = statBlockOf("Ghoul");
      var copy = StatBlockCloner.deepCopy(base);

      // Cloning a creature must not clone the Poisoned condition.
      assertThat(copy.getConditionImmunities())
          .containsExactlyInAnyOrderElementsOf(base.getConditionImmunities());
      base.getConditionImmunities().forEach(c ->
          assertThat(copy.getConditionImmunities()).contains(c));
    }
  }

  @Test
  @DisplayName("An NPC wraps a monster the way a character wraps a species")
  void npcFromMonster() {
    var bossBlock = statBlockOf("Goblin Boss");
    var grish = NpcFactory.fromStatBlock(dm, "Grish", bossBlock);
    em.persist(grish);
    em.flush();

    assertThat(grish.getName()).isEqualTo("Grish");
    assertThat(grish.getBaseStatBlockId()).isEqualTo(bossBlock.getId());
    // Its own copy, so levelling Grish up does not arm every goblin boss in the
    // compendium.
    assertThat(grish.getStatBlock().getId()).isNotEqualTo(bossBlock.getId());
    assertThat(grish.getStatBlock().getFeatures()).hasSameSizeAs(bossBlock.getFeatures());

    grish.getStatBlock().setArmorClass(21);
    em.flush();
    em.clear();
    assertThat(statBlockOf("Goblin Boss").getArmorClass()).isNotEqualTo(21);
  }
}
