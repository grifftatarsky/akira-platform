package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.Activation;
import com.gpt.oozengine.constant.rules.AttackKind;
import com.gpt.oozengine.constant.rules.ConditionCode;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.CreatureType;
import com.gpt.oozengine.constant.rules.DamageResponseKind;
import com.gpt.oozengine.constant.rules.DamageType;
import com.gpt.oozengine.constant.rules.Delivery;
import com.gpt.oozengine.constant.rules.EffectKind;
import com.gpt.oozengine.constant.rules.EffectOutcome;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.constant.rules.SenseType;
import com.gpt.oozengine.constant.rules.Skill;
import com.gpt.oozengine.constant.rules.StepTrigger;
import com.gpt.oozengine.constant.rules.UsesReset;
import com.gpt.oozengine.model.dto.request.EffectRequest;
import com.gpt.oozengine.model.dto.request.FeatureRequest;
import com.gpt.oozengine.model.dto.request.FeatureStepRequest;
import com.gpt.oozengine.model.dto.request.MonsterRequest;
import com.gpt.oozengine.model.dto.request.StatBlockRequest;
import com.gpt.oozengine.model.dto.response.FeatureResponse;
import com.gpt.oozengine.model.dto.response.MonsterResponse;
import com.gpt.oozengine.repository.ConditionRepository;
import com.gpt.oozengine.service.MonsterService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/**
 * The payload the stat block editor sends, exercised through the service the
 * controller calls.
 *
 * <p>What is actually under test is the update strategy: value collections are
 * replaced wholesale, features are matched on id. Getting that wrong is silent
 * — the block still saves, it just quietly reassigns every feature's identity
 * on each keystroke-to-save cycle and breaks anything referencing them.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class StatBlockEditorTests {

  @Autowired private MonsterService monsters;
  @Autowired private ConditionRepository conditions;

  private UUID grappledId() {
    return conditions.findByOwnerIdIsNull().stream()
        .filter(c -> c.getCode() == ConditionCode.GRAPPLED)
        .findFirst()
        .orElseThrow()
        .getId();
  }

  private UUID poisonedId() {
    return conditions.findByOwnerIdIsNull().stream()
        .filter(c -> c.getCode() == ConditionCode.POISONED)
        .findFirst()
        .orElseThrow()
        .getId();
  }

  /**
   * A feature with only the fields these tests care about. FeatureRequest has 22
   * components and positional nulls for the other sixteen are unreadable and
   * easy to miscount.
   */
  private static FeatureRequest feature(
      UUID id, String name, Activation activation, UsesReset reset, Integer usesMax,
      Integer rechargeMin, Integer rechargeMax, List<FeatureStepRequest> steps) {
    return new FeatureRequest(
        id, name, null, activation, null, null, null, null, false,
        reset, usesMax, rechargeMin, rechargeMax,
        null, null, null, null, null, null, null,
        steps, List.of());
  }

  /** An attack that both damages and grapples on the same hit. */
  private static FeatureRequest tentacle(UUID id, UUID grappled, int attackBonus) {
    FeatureStepRequest swing =
        new FeatureStepRequest(null, StepTrigger.ALWAYS, null, Delivery.ATTACK_ROLL,
            AttackKind.MELEE, attackBonus, null, 15, null, null, null, null, null,
            List.of(
                new EffectRequest(null, EffectOutcome.HIT, EffectKind.DAMAGE, 2, 6, 5, 12,
                    DamageType.BLUDGEONING, false, null, null, null, null, null, null, null, null),
                new EffectRequest(null, EffectOutcome.HIT, EffectKind.APPLY_CONDITION, null, null,
                    null, null, null, false, grappled, 14, null, null, null, null, null,
                    "Large or smaller creatures only.")));
    return feature(id, "Tentacle", Activation.ACTION, UsesReset.AT_WILL, null, null, null,
        List.of(swing));
  }

  /**
   * The chained shape the book uses: an attack, and only on a hit, a save. The
   * Ghoul, the werecreatures and eleven others resolve this way.
   */
  private static FeatureRequest chainedBite(UUID grappled) {
    FeatureStepRequest bite =
        new FeatureStepRequest(null, StepTrigger.ALWAYS, null, Delivery.ATTACK_ROLL,
            AttackKind.MELEE, 4, null, 5, null, null, null, null, null,
            List.of(new EffectRequest(null, EffectOutcome.HIT, EffectKind.DAMAGE, 1, 4, 2, 4,
                DamageType.PIERCING, false, null, null, null, null, null, null, null, null)));
    FeatureStepRequest paralysis =
        new FeatureStepRequest(null, StepTrigger.ON_PREVIOUS_HIT,
            "If the target is a creature that isn't an Undead or elf", Delivery.SAVING_THROW,
            null, null, null, null, null, null, Ability.CONSTITUTION, 10, null,
            List.of(new EffectRequest(null, EffectOutcome.SAVE_FAILURE,
                EffectKind.APPLY_CONDITION, null, null, null, null, null, false, grappled, null,
                null, null, null, null, null, null)));
    return feature(null, "Claw", Activation.ACTION, UsesReset.AT_WILL, null, null, null,
        List.of(bite, paralysis));
  }

  private static StatBlockRequest block(UUID grappled, List<FeatureRequest> features) {
    return new StatBlockRequest(
        CreatureSize.LARGE, CreatureType.ABERRATION, null, null,
        17, null, 7, 150, 20, 10, 40,
        Map.of(MovementType.WALK, 10, MovementType.SWIM, 40, MovementType.FLY, 0),
        false,
        21, 9, 15, 18, 15, 18,
        Map.of(Ability.CONSTITUTION, 6),
        Map.of(Skill.HISTORY, 12, Skill.PERCEPTION, 10),
        Map.of(SenseType.DARKVISION, 120),
        20,
        List.of(new StatBlockRequest.DamageResponseEntry(
            DamageType.PSYCHIC, DamageResponseKind.IMMUNITY, null)),
        Set.of(grappled),
        "Deep Speech", 120,
        new BigDecimal("10"), 5900, 4,
        null, null, null, 3,
        features,
        // A creature's spells are not what these tests are about, and an empty
        // list says "it has none" where null would say "leave them alone".
        List.of());
  }

  @Test
  @DisplayName("a full stat block saves and reads back through the editor's payload")
  void editorPayloadRoundTrips() {
    UUID grappled = grappledId();
    UUID user = UUID.randomUUID();

    MonsterResponse created =
        monsters.create(
            new MonsterRequest("Editor Aboleth", "A test creature.",
                block(grappled, List.of(tentacle(null, grappled, 9)))),
            user);

    assertThat(created.statBlock().size()).isEqualTo(CreatureSize.LARGE);
    assertThat(created.statBlock().speeds())
        .containsEntry(MovementType.WALK, 10)
        .containsEntry(MovementType.SWIM, 40)
        .doesNotContainKey(MovementType.FLY); // a zero speed is "hasn't got one"
    assertThat(created.statBlock().skills()).containsEntry("HISTORY", 12);
    assertThat(created.statBlock().senses()).containsEntry("DARKVISION", 120);
    assertThat(created.statBlock().damageResponses()).containsExactly("IMMUNITY PSYCHIC");
    assertThat(created.statBlock().conditionImmunities()).containsExactly("Grappled");
    assertThat(created.statBlock().challengeRating()).isEqualByComparingTo("10");
    assertThat(created.hitPoints()).isEqualTo("150 (20d10 + 40)");

    FeatureResponse f = created.statBlock().features().getFirst();
    assertThat(f.steps()).hasSize(1);
    var swing = f.steps().getFirst();
    assertThat(swing.attackBonus()).isEqualTo(9);
    assertThat(swing.effects()).hasSize(2);
    assertThat(swing.effects().getFirst().amount()).isEqualTo("2d6 + 5");
    assertThat(swing.effects().get(1).conditionName()).isEqualTo("Grappled");
    assertThat(swing.effects().get(1).escapeDc()).isEqualTo(14);

    monsters.delete(created.id(), user);
  }

  @Test
  @DisplayName("editing keeps a feature's identity and drops the ones removed")
  void featureIdentitySurvivesAnEdit() {
    UUID grappled = grappledId();
    UUID user = UUID.randomUUID();

    MonsterResponse created =
        monsters.create(
            new MonsterRequest("Identity Aboleth", null,
                block(grappled, List.of(tentacle(null, grappled, 9)))),
            user);
    UUID tentacleId = created.statBlock().features().getFirst().id();

    // Keep the tentacle (by id, with a changed bonus), add a second feature.
    FeatureRequest bite =
        feature(null, "Bite", Activation.BONUS_ACTION, UsesReset.RECHARGE, null, 5, 6,
            List.of(new FeatureStepRequest(null, StepTrigger.ALWAYS, null, Delivery.ATTACK_ROLL,
                AttackKind.MELEE, 7, null, 5, null, null, null, null, null,
                List.of(new EffectRequest(null, EffectOutcome.HIT, EffectKind.DAMAGE, 1, 8, 3, 7,
                    DamageType.PIERCING, false, null, null, null, null, null, null, null,
                    null)))));

    MonsterResponse edited =
        monsters.update(
            created.id(),
            new MonsterRequest("Identity Aboleth", null,
                block(grappled, List.of(tentacle(tentacleId, grappled, 11), bite))),
            user);

    var names = edited.statBlock().features().stream().map(FeatureResponse::name).toList();
    assertThat(names).containsExactly("Tentacle", "Bite");
    assertThat(edited.statBlock().features().getFirst().id())
        .as("the kept feature holds its id, so Multiattack still points at it")
        .isEqualTo(tentacleId);
    assertThat(edited.statBlock().features().getFirst().steps().getFirst().attackBonus())
        .isEqualTo(11);
    assertThat(edited.statBlock().features().get(1).rechargeMin()).isEqualTo(5);

    // Now remove the tentacle entirely.
    MonsterResponse pruned =
        monsters.update(
            created.id(),
            new MonsterRequest("Identity Aboleth", null, block(grappled, List.of(bite))),
            user);
    assertThat(pruned.statBlock().features()).hasSize(1);
    assertThat(pruned.statBlock().features().getFirst().name()).isEqualTo("Bite");

    monsters.delete(created.id(), user);
  }

  @Test
  @DisplayName("omitting the stat block leaves the creature's mechanics alone")
  void renameDoesNotWipeMechanics() {
    UUID grappled = grappledId();
    UUID user = UUID.randomUUID();
    MonsterResponse created =
        monsters.create(
            new MonsterRequest("Rename Me", null,
                block(grappled, List.of(tentacle(null, grappled, 9)))),
            user);

    MonsterResponse renamed =
        monsters.update(created.id(), new MonsterRequest("Renamed", "New flavour.", null), user);

    assertThat(renamed.name()).isEqualTo("Renamed");
    assertThat(renamed.statBlock().features()).hasSize(1);
    assertThat(renamed.statBlock().armorClass()).isEqualTo(17);

    monsters.delete(created.id(), user);
  }

  @Test
  @DisplayName("a chained attack-then-save keeps both rolls")
  void chainedStepsRoundTrip() {
    UUID grappled = grappledId();
    UUID user = UUID.randomUUID();
    MonsterResponse created =
        monsters.create(
            new MonsterRequest("Chained Ghoul", null,
                block(grappled, List.of(chainedBite(grappled)))),
            user);

    var steps = created.statBlock().features().getFirst().steps();
    assertThat(steps).hasSize(2);
    assertThat(steps.getFirst().delivery()).isEqualTo(Delivery.ATTACK_ROLL);
    assertThat(steps.getFirst().trigger()).isEqualTo(StepTrigger.ALWAYS);
    assertThat(steps.get(1).delivery()).isEqualTo(Delivery.SAVING_THROW);
    assertThat(steps.get(1).trigger()).isEqualTo(StepTrigger.ON_PREVIOUS_HIT);
    assertThat(steps.get(1).saveDc()).isEqualTo(10);
    assertThat(steps.get(1).targetFilter()).contains("Undead or elf");
    assertThat(steps.get(1).effects()).hasSize(1);

    monsters.delete(created.id(), user);
  }

  @Test
  @DisplayName("replacing a condition immunity does not leave the old one behind")
  void collectionsAreReplacedNotMerged() {
    UUID user = UUID.randomUUID();
    MonsterResponse created =
        monsters.create(
            new MonsterRequest("Immunity Test", null, block(grappledId(), List.of())), user);
    assertThat(created.statBlock().conditionImmunities()).containsExactly("Grappled");

    MonsterResponse edited =
        monsters.update(
            created.id(),
            new MonsterRequest("Immunity Test", null, block(poisonedId(), List.of())),
            user);
    assertThat(edited.statBlock().conditionImmunities()).containsExactly("Poisoned");

    monsters.delete(created.id(), user);
  }
}
