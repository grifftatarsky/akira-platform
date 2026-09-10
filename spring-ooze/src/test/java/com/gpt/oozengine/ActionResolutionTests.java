package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.rules.CoverDegree;
import com.gpt.oozengine.constant.rules.DamageResponseKind;
import com.gpt.oozengine.constant.rules.DamageType;
import com.gpt.oozengine.constant.rules.Delivery;
import com.gpt.oozengine.constant.rules.EffectKind;
import com.gpt.oozengine.constant.rules.EffectOutcome;
import com.gpt.oozengine.constant.rules.StepTrigger;
import com.gpt.oozengine.model.battle.Participant;
import com.gpt.oozengine.model.mechanics.DiceRoll;
import com.gpt.oozengine.model.mechanics.Effect;
import com.gpt.oozengine.model.mechanics.Feature;
import com.gpt.oozengine.model.mechanics.FeatureStep;
import com.gpt.oozengine.service.ActionResolver;
import com.gpt.oozengine.service.TargetContext;
import com.gpt.oozengine.util.BattleDice;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Executing a feature, clause by clause.
 *
 * <p>Driven straight against the resolver, which is pure — no database, no
 * battle, no log. That is the point of it being pure: every rule in here is a
 * claim about the SRD, and it should be provable without starting Postgres.
 */
class ActionResolutionTests {

  private static final long SEED = 20260909L;

  /**
   * Ids are database-generated and have no setter, which is right — but the
   * resolver keys its cover information by id, so a test needs distinct ones.
   */
  private static void assignId(Participant p) {
    try {
      var field = Class.forName("com.gpt.oozengine.model.BaseEntity").getDeclaredField("id");
      field.setAccessible(true);
      field.set(p, UUID.randomUUID());
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    }
  }

  private static Participant target(String name, int armorClass, int hitPoints) {
    Participant p = new Participant();
    assignId(p);
    p.setName(name);
    p.setArmorClass(armorClass);
    p.setMaxHitPoints(hitPoints);
    p.setCurrentHitPoints(hitPoints);
    return p;
  }

  private static Feature attack(int bonus, int diceCount, int faces, int bonusDamage,
      DamageType type) {
    Feature f = new Feature();
    f.setName("Rend");
    FeatureStep step = new FeatureStep();
    step.setDelivery(Delivery.ATTACK_ROLL);
    step.setAttackBonus(bonus);
    Effect e = new Effect();
    e.setKind(EffectKind.DAMAGE);
    e.setOutcome(EffectOutcome.HIT);
    e.setDamageType(type);
    e.setAmount(new DiceRoll(diceCount, faces, bonusDamage,
        diceCount * (faces + 1) / 2 + bonusDamage));
    step.getEffects().add(e);
    f.getSteps().add(step);
    return f;
  }

  /** Resolves with a seed chosen so the die is known. */
  private static List<ActionResolver.Outcome> resolve(Feature f, Participant t, long rollIndex) {
    return resolve(f, t, rollIndex, TargetContext.open(t.getId()));
  }

  private static List<ActionResolver.Outcome> resolve(Feature f, Participant t, long rollIndex,
      TargetContext ctx) {
    return ActionResolver.resolve(target("Owlbear", 13, 59), f, List.of(t),
        Map.of(t.getId(), ctx), new BattleDice(SEED), rollIndex).outcomes();
  }

  /** The first roll index whose d20 lands on the wanted face. */
  private static long indexRolling(int face) {
    var dice = new BattleDice(SEED);
    for (long i = 0; i < 10_000; i++) {
      if (dice.d20(i, 0, java.util.EnumSet.noneOf(com.gpt.oozengine.constant.DiceModifiers.class))
          .kept() == face) {
        return i;
      }
    }
    throw new IllegalStateException("No index rolls a " + face);
  }

  @Nested
  @DisplayName("Attack rolls")
  class Attacks {

    @Test
    @DisplayName("A hit deals damage; a miss deals none")
    void hitAndMiss() {
      var thalia = target("Thalia", 16, 31);
      var high = resolve(attack(7, 2, 8, 5, DamageType.SLASHING), thalia, indexRolling(18));
      var low = resolve(attack(7, 2, 8, 5, DamageType.SLASHING), thalia, indexRolling(2));

      assertThat(high).hasAtLeastOneElementOfType(ActionResolver.Damage.class);
      assertThat(low).noneMatch(o -> o instanceof ActionResolver.Damage);
    }

    @Test
    @DisplayName("A natural 20 hits whatever the Armor Class is")
    void naturalTwentyAlwaysHits() {
      // AC 30 is unreachable with +0, so only the rule can carry this.
      var wall = target("Wall", 30, 100);
      var out = resolve(attack(0, 1, 6, 0, DamageType.BLUDGEONING), wall, indexRolling(20));

      var roll = (ActionResolver.AttackRoll) out.getFirst();
      assertThat(roll.hit()).isTrue();
      assertThat(roll.critical()).isTrue();
      assertThat(roll.total()).isLessThan(roll.armorClass());
    }

    @Test
    @DisplayName("A natural 1 misses whatever the bonus is")
    void naturalOneAlwaysMisses() {
      var soft = target("Straw", 5, 10);
      var out = resolve(attack(20, 1, 6, 0, DamageType.BLUDGEONING), soft, indexRolling(1));

      var roll = (ActionResolver.AttackRoll) out.getFirst();
      assertThat(roll.hit()).isFalse();
      assertThat(roll.total()).isGreaterThan(roll.armorClass());
    }

    @Test
    @DisplayName("A critical doubles the dice but not the modifier")
    void criticalDoublesDiceOnly() {
      var dummy = target("Dummy", 5, 100);
      var out = resolve(attack(0, 2, 8, 5, DamageType.SLASHING), dummy, indexRolling(20));
      var damage = (ActionResolver.Damage) out.stream()
          .filter(o -> o instanceof ActionResolver.Damage).findFirst().orElseThrow();

      // 2d8 + 5 averages 14; the critical adds the dice again (9) and not the 5.
      assertThat(damage.amount()).isEqualTo(23);
    }

    @Test
    @DisplayName("Cover raises the Armor Class rather than lowering the roll")
    void coverRaisesTheTarget() {
      var bram = target("Bram", 16, 40);
      var out = resolve(attack(7, 1, 6, 0, DamageType.SLASHING), bram, indexRolling(11),
          TargetContext.of(bram.getId(), CoverDegree.HALF, true));
      var roll = (ActionResolver.AttackRoll) out.getFirst();

      // Half Cover is "+2 bonus to AC" — so the die stays honest in the log and
      // the number to beat moves.
      assertThat(roll.armorClass()).isEqualTo(18);
      assertThat(roll.roll().kept()).isEqualTo(11);
    }

    @Test
    @DisplayName("Total Cover cannot be targeted at all")
    void totalCoverRefuses() {
      var hidden = target("Hidden", 10, 10);
      var out = resolve(attack(20, 1, 6, 0, DamageType.SLASHING), hidden, 0,
          TargetContext.of(hidden.getId(), CoverDegree.TOTAL, true));

      // "can't be targeted directly" is a refusal, not a penalty — so it is said
      // in the log rather than quietly missing.
      assertThat(out).singleElement().isInstanceOf(ActionResolver.NeedsAdjudication.class);
      assertThat(((ActionResolver.NeedsAdjudication) out.getFirst()).text())
          .contains("Total Cover");
    }
  }

  @Nested
  @DisplayName("Damage responses")
  class Responses {

    private ActionResolver.Damage damageAgainst(DamageResponseKind response) {
      var p = target("Golem", 5, 100);
      if (response != null) {
        p.getDamageResponses().put(DamageType.FIRE, response);
      }
      var out = resolve(attack(20, 2, 6, 0, DamageType.FIRE), p, indexRolling(15));
      return (ActionResolver.Damage) out.stream()
          .filter(o -> o instanceof ActionResolver.Damage).findFirst().orElseThrow();
    }

    @Test
    @DisplayName("Resistance halves, vulnerability doubles, immunity zeroes")
    void responsesApply() {
      assertThat(damageAgainst(null).afterResponse()).isEqualTo(7);
      assertThat(damageAgainst(DamageResponseKind.RESISTANCE).afterResponse()).isEqualTo(3);
      assertThat(damageAgainst(DamageResponseKind.VULNERABILITY).afterResponse()).isEqualTo(14);
      assertThat(damageAgainst(DamageResponseKind.IMMUNITY).afterResponse()).isZero();
    }

    @Test
    @DisplayName("The log keeps what was rolled as well as what landed")
    void bothNumbersAreKept() {
      var d = damageAgainst(DamageResponseKind.RESISTANCE);

      // A log that kept only the applied number cannot show a DM why a 7 became
      // a 3, which is the moment they most want to check the engine.
      assertThat(d.amount()).isEqualTo(7);
      assertThat(d.afterResponse()).isEqualTo(3);
    }
  }

  @Nested
  @DisplayName("Saving throws and chained steps")
  class Saves {

    private Feature breathWeapon() {
      Feature f = new Feature();
      f.setName("Acid Breath");
      FeatureStep step = new FeatureStep();
      step.setDelivery(Delivery.SAVING_THROW);
      step.setSaveDc(14);
      Effect fail = new Effect();
      fail.setKind(EffectKind.DAMAGE);
      fail.setOutcome(EffectOutcome.SAVE_FAILURE);
      fail.setDamageType(DamageType.ACID);
      fail.setAmount(new DiceRoll(4, 6, null, 14));
      step.getEffects().add(fail);
      f.getSteps().add(step);
      return f;
    }

    @Test
    @DisplayName("A failed save takes the damage; a successful one does not")
    void savesGate() {
      var p = target("Thalia", 16, 31);
      var failed = resolve(breathWeapon(), p, indexRolling(3));
      var passed = resolve(breathWeapon(), p, indexRolling(19));

      assertThat(failed).hasAtLeastOneElementOfType(ActionResolver.Damage.class);
      assertThat(passed).noneMatch(o -> o instanceof ActionResolver.Damage);
    }

    @Test
    @DisplayName("A chained save only fires when the attack that gates it hits")
    void chainedStepsRespectTheirTrigger() {
      // Fourteen creatures in the bestiary attack and then force a save on a
      // hit. Running the second step unconditionally would have a werewolf
      // infect everything it swings at.
      Feature bite = attack(7, 1, 8, 3, DamageType.PIERCING);
      FeatureStep curse = new FeatureStep();
      curse.setDelivery(Delivery.SAVING_THROW);
      curse.setSaveDc(12);
      curse.setTrigger(StepTrigger.ON_PREVIOUS_HIT);
      bite.getSteps().add(curse);

      var weak = target("Thalia", 30, 31);
      var soft = target("Thalia", 5, 31);

      assertThat(resolve(bite, weak, indexRolling(9)))
          .noneMatch(o -> o instanceof ActionResolver.SavingThrow);
      assertThat(resolve(bite, soft, indexRolling(9)))
          .hasAtLeastOneElementOfType(ActionResolver.SavingThrow.class);
    }
  }

  @Test
  @DisplayName("A feature with nothing to roll goes to the DM, and still counts")
  void proseIsAFirstClassPath() {
    Feature shapeShift = new Feature();
    shapeShift.setName("Shape-Shift");
    shapeShift.setDescription("The oni shape-shifts into a Small or Medium Humanoid.");
    var p = target("Thalia", 16, 31);

    var out = ActionResolver.resolve(target("Oni", 16, 110), shapeShift, List.of(p),
        Map.of(), new BattleDice(SEED), 0).outcomes();

    // The book wrote a rule, not a procedure. It still lands in the log, with
    // the text, so a DM can act on it rather than being told nothing happened.
    assertThat(out).singleElement().isInstanceOf(ActionResolver.NeedsAdjudication.class);
    assertThat(((ActionResolver.NeedsAdjudication) out.getFirst()).text())
        .contains("shape-shifts");
  }

  @Test
  @DisplayName("The same seed and index resolve the same way, every time")
  void resolutionIsReproducible() {
    var p = target("Thalia", 16, 31);
    var first = resolve(attack(7, 2, 8, 5, DamageType.SLASHING), p, 12);
    var second = resolve(attack(7, 2, 8, 5, DamageType.SLASHING), p, 12);

    // Without this a rewind would replay a different fight rather than the same
    // one a step earlier.
    assertThat(((ActionResolver.AttackRoll) first.getFirst()).total())
        .isEqualTo(((ActionResolver.AttackRoll) second.getFirst()).total());
  }
}
