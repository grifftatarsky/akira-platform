package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.SrdVersion;
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
import com.gpt.oozengine.model.Condition;
import com.gpt.oozengine.model.Monster;
import com.gpt.oozengine.model.creature.DamageResponse;
import com.gpt.oozengine.model.creature.SenseRange;
import com.gpt.oozengine.model.creature.SkillBonus;
import com.gpt.oozengine.model.creature.StatBlock;
import com.gpt.oozengine.model.mechanics.DiceRoll;
import com.gpt.oozengine.model.mechanics.Effect;
import com.gpt.oozengine.model.mechanics.Feature;
import com.gpt.oozengine.model.mechanics.FeatureComponent;
import com.gpt.oozengine.model.mechanics.FeatureStep;
import com.gpt.oozengine.repository.ConditionRepository;
import com.gpt.oozengine.repository.FeatureRepository;
import com.gpt.oozengine.repository.MonsterRepository;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;

/**
 * The rules model, exercised by building a real stat block rather than by
 * asserting that columns exist.
 *
 * <p>The subject is the Aboleth's Tentacle, because it is the case that decides
 * whether the model is expressive enough: one attack, two consequences on the
 * same hit — damage, and a condition with an escape DC — plus a Multiattack that
 * refers to it rather than restating it.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class RulesModelTests {

  @Autowired private MonsterRepository monsters;
  @Autowired private ConditionRepository conditions;
  @Autowired private FeatureRepository features;

  @Test
  @Transactional
  @DisplayName("a stat block round-trips with its features, effects and collections")
  void statBlockRoundTrips() {
    Condition grappled =
        conditions.findByOwnerIdIsNull().stream()
            .filter(c -> c.getCode() == ConditionCode.GRAPPLED)
            .findFirst()
            .orElseThrow();

    StatBlock block = new StatBlock();
    block.setSize(CreatureSize.LARGE);
    block.setCreatureType(CreatureType.ABERRATION);
    block.setArmorClass(17);
    block.setInitiativeBonus(7);
    block.setHitPoints(new DiceRoll(20, 10, 40, 150));
    block.getSpeeds().put(MovementType.WALK, 10);
    block.getSpeeds().put(MovementType.SWIM, 40);
    block.setStrength(21);
    block.setDexterity(9);
    block.setConstitution(15);
    block.getSaveBonuses().put(Ability.CONSTITUTION, 6);
    block.getSkills().add(new SkillBonus(Skill.HISTORY, 12));
    block.getSenses().add(new SenseRange(SenseType.DARKVISION, 120));
    block.getDamageResponses()
        .add(new DamageResponse(DamageType.PSYCHIC, DamageResponseKind.IMMUNITY, null));
    block.getConditionImmunities().add(grappled);
    block.setChallengeRating(new BigDecimal("10"));
    block.setProficiencyBonus(4);

    Feature tentacle = new Feature();
    tentacle.setName("Tentacle");
    tentacle.setActivation(Activation.ACTION);
    FeatureStep swing = new FeatureStep();
    swing.setDelivery(Delivery.ATTACK_ROLL);
    swing.setAttackKind(AttackKind.MELEE);
    swing.setAttackBonus(9);
    swing.setReachFeet(15);

    Effect damage = new Effect();
    damage.setOutcome(EffectOutcome.HIT);
    damage.setKind(EffectKind.DAMAGE);
    damage.setAmount(new DiceRoll(2, 6, 5, 12));
    damage.setDamageType(DamageType.BLUDGEONING);
    swing.addEffect(damage);

    // The rider that makes the Tentacle more than a damage roll, and the reason
    // effects are a list rather than one column per outcome.
    Effect grapple = new Effect();
    grapple.setOutcome(EffectOutcome.HIT);
    grapple.setKind(EffectKind.APPLY_CONDITION);
    grapple.setCondition(grappled);
    grapple.setEscapeDc(14);
    grapple.setNotes("Large or smaller creatures only; one of four tentacles.");
    swing.addEffect(grapple);
    tentacle.addStep(swing);
    block.addFeature(tentacle);

    Feature multiattack = new Feature();
    multiattack.setName("Multiattack");
    multiattack.setActivation(Activation.ACTION);
    FeatureComponent twoTentacles = new FeatureComponent();
    twoTentacles.setReferencedFeature(tentacle);
    twoTentacles.setCount(2);
    multiattack.addComponent(twoTentacles);
    block.addFeature(multiattack);

    Monster aboleth = new Monster();
    aboleth.setName("Test Aboleth");
    aboleth.setStatBlock(block);
    Monster saved = monsters.saveAndFlush(aboleth);

    Monster read = monsters.findById(saved.getId()).orElseThrow();
    StatBlock rb = read.getStatBlock();
    assertThat(rb.getHitPoints().expression()).isEqualTo("20d10 + 40");
    assertThat(rb.getHitPoints().getAverage()).isEqualTo(150);
    assertThat(rb.getSpeeds()).containsEntry(MovementType.SWIM, 40);
    assertThat(rb.modifier(Ability.STRENGTH)).isEqualTo(5);
    assertThat(rb.saveBonus(Ability.CONSTITUTION)).isEqualTo(6);
    assertThat(rb.saveBonus(Ability.DEXTERITY)).isEqualTo(-1); // falls back to the modifier
    assertThat(rb.getConditionImmunities()).extracting(Condition::getName).containsExactly("Grappled");

    Feature readTentacle = rb.getFeatures().getFirst();
    assertThat(readTentacle.getName()).isEqualTo("Tentacle");
    assertThat(readTentacle.getSteps()).hasSize(1);
    FeatureStep readSwing = readTentacle.getSteps().getFirst();
    assertThat(readSwing.getAttackBonus()).isEqualTo(9);
    assertThat(readSwing.getEffects()).hasSize(2);
    assertThat(readSwing.getEffects().getFirst().getAmount().expression()).isEqualTo("2d6 + 5");
    assertThat(readSwing.getEffects().get(1).getCondition().getCode())
        .isEqualTo(ConditionCode.GRAPPLED);
    assertThat(readSwing.getEffects().get(1).getEscapeDc()).isEqualTo(14);

    Feature readMultiattack = rb.getFeatures().get(1);
    assertThat(readMultiattack.getComponents()).hasSize(1);
    assertThat(readMultiattack.getComponents().getFirst().getReferencedFeature().getName())
        .isEqualTo("Tentacle");
    assertThat(readMultiattack.getComponents().getFirst().getCount()).isEqualTo(2);

    // The owner columns are mirrored read-only, which is what lets the simulator
    // fetch a creature's actions without loading the monster aggregate.
    List<Feature> byOwner = features.findByStatBlockIdOrderByOrdinalAsc(rb.getId());
    assertThat(byOwner).extracting(Feature::getName).containsExactly("Tentacle", "Multiattack");

    monsters.delete(read);
  }

  @Test
  @Transactional
  @DisplayName("the bestiary import gave every base monster a stat block")
  void importedMonstersHaveStatBlocks() {
    var base = monsters.findByOwnerIdIsNull();
    assertThat(base).hasSizeGreaterThan(300);
    assertThat(base).allSatisfy(m -> {
      assertThat(m.getStatBlock()).as(m.getName()).isNotNull();
      assertThat(m.getStatBlock().getSize()).as(m.getName()).isNotNull();
      assertThat(m.getStatBlock().getChallengeRating()).as(m.getName()).isNotNull();
      assertThat(m.getStatBlock().getSpeeds()).as(m.getName()).isNotEmpty();
      assertThat(m.getSrdVersion()).isEqualTo(SrdVersion.SRD_5_2);
    });
  }

  @Test
  @Transactional
  @DisplayName("a creature the book prints a subtype for keeps it")
  void subtypeSurvivesTheSplit() {
    StatBlock s = byName("Goblin Warrior").getStatBlock();
    assertThat(s.getCreatureType()).isEqualTo(CreatureType.FEY);
    assertThat(s.getCreatureSubtype()).isEqualTo("Goblinoid");
    assertThat(s.getChallengeRating()).isEqualByComparingTo("0.25");
  }

  @Test
  @Transactional
  @DisplayName("the Adult Red Dragon imports as the book prints it")
  void dragonMatchesTheBook() {
    StatBlock s = byName("Adult Red Dragon").getStatBlock();
    assertThat(s.getSize()).isEqualTo(CreatureSize.HUGE);
    assertThat(s.getCreatureType()).isEqualTo(CreatureType.DRAGON);
    assertThat(s.getCreatureSubtype()).isEqualTo("Chromatic");
    assertThat(s.getArmorClass()).isEqualTo(19);
    assertThat(s.getHitPoints().getAverage()).isEqualTo(256);
    assertThat(s.getHitPoints().expression()).isEqualTo("19d12 + 133");
    assertThat(s.getSpeeds())
        .containsEntry(MovementType.WALK, 40)
        .containsEntry(MovementType.CLIMB, 40)
        .containsEntry(MovementType.FLY, 80);
    assertThat(s.getChallengeRating()).isEqualByComparingTo("17");
    assertThat(s.getExperiencePoints()).isEqualTo(18000);
    assertThat(s.getProficiencyBonus()).isEqualTo(6);
    assertThat(s.getLegendaryActionUses()).isEqualTo(3);
    assertThat(s.getSaveBonuses()).containsEntry(Ability.DEXTERITY, 6);
    assertThat(s.getSkills()).extracting(SkillBonus::getSkill).contains(Skill.PERCEPTION);
    assertThat(s.getDamageResponses())
        .anySatisfy(d -> assertThat(d.getDamageType()).isEqualTo(DamageType.FIRE));

    // Rend: two damage types on one hit, which is what makes effects a list.
    FeatureStep rend = onlyStep(feature(s, "Rend"));
    assertThat(rend.getDelivery()).isEqualTo(Delivery.ATTACK_ROLL);
    assertThat(rend.getAttackBonus()).isEqualTo(14);
    assertThat(rend.getReachFeet()).isEqualTo(10);
    assertThat(rend.getEffects()).hasSize(2);
    assertThat(rend.getEffects().getFirst().getAmount().expression()).isEqualTo("1d10 + 8");
    assertThat(rend.getEffects().getFirst().getDamageType()).isEqualTo(DamageType.SLASHING);
    assertThat(rend.getEffects().get(1).getAmount().expression()).isEqualTo("2d4");
    assertThat(rend.getEffects().get(1).getDamageType()).isEqualTo(DamageType.FIRE);

    // Fire Breath: a recharge, a save, and half damage on a success.
    Feature breathFeature = feature(s, "Fire Breath");
    assertThat(breathFeature.getUsesReset()).isEqualTo(UsesReset.RECHARGE);
    assertThat(breathFeature.getRechargeMin()).isEqualTo(5);
    assertThat(breathFeature.getRechargeMax()).isEqualTo(6);
    FeatureStep breath = onlyStep(breathFeature);
    assertThat(breath.getDelivery()).isEqualTo(Delivery.SAVING_THROW);
    assertThat(breath.getSaveAbility()).isEqualTo(Ability.DEXTERITY);
    assertThat(breath.getSaveDc()).isEqualTo(21);
    assertThat(breath.getEffects()).extracting(Effect::getOutcome)
        .containsExactly(EffectOutcome.SAVE_FAILURE, EffectOutcome.SAVE_SUCCESS);
    assertThat(breath.getEffects().getFirst().getAmount().expression()).isEqualTo("17d6");
    assertThat(breath.getEffects().get(1).isHalfDamage()).isTrue();
  }

  @Test
  @Transactional
  @DisplayName("a condition rider links to the conditions table, not to prose")
  void ridersLinkToConditionRows() {
    StatBlock s = byName("Aboleth").getStatBlock();
    Feature tentacle = feature(s, "Tentacle");
    Effect grapple = onlyStep(tentacle).getEffects().stream()
        .filter(e -> e.getKind() == EffectKind.APPLY_CONDITION)
        .findFirst()
        .orElseThrow();
    assertThat(grapple.getCondition().getCode()).isEqualTo(ConditionCode.GRAPPLED);
    assertThat(grapple.getEscapeDc()).isEqualTo(14);
    assertThat(s.getConditionImmunities()).isEmpty();

    // An Air Elemental's immunity list is the other half of the same link.
    StatBlock air = byName("Air Elemental").getStatBlock();
    assertThat(air.getConditionImmunities())
        .extracting(Condition::getCode)
        .contains(ConditionCode.PARALYZED, ConditionCode.PRONE, ConditionCode.UNCONSCIOUS);
  }

  @Test
  @Transactional
  @DisplayName("a chained attack-then-save imports as two steps")
  void chainedFeaturesImportAsSteps() {
    // The Ghoul's Claw is an attack and then, only on a hit, a save against
    // paralysis. Under a single-delivery model the save existed only as prose.
    Feature claw = feature(byName("Ghoul").getStatBlock(), "Claw");
    assertThat(claw.getSteps()).hasSize(2);

    FeatureStep swipe = claw.getSteps().getFirst();
    assertThat(swipe.getTrigger()).isEqualTo(StepTrigger.ALWAYS);
    assertThat(swipe.getDelivery()).isEqualTo(Delivery.ATTACK_ROLL);
    assertThat(swipe.getAttackBonus()).isEqualTo(4);
    assertThat(swipe.getEffects().getFirst().getAmount().expression()).isEqualTo("1d4 + 2");

    FeatureStep paralysis = claw.getSteps().get(1);
    assertThat(paralysis.getTrigger()).isEqualTo(StepTrigger.ON_PREVIOUS_HIT);
    assertThat(paralysis.getDelivery()).isEqualTo(Delivery.SAVING_THROW);
    assertThat(paralysis.getSaveAbility()).isEqualTo(Ability.CONSTITUTION);
    assertThat(paralysis.getSaveDc()).isEqualTo(10);
    assertThat(paralysis.getTargetFilter()).contains("Undead or elf");
    assertThat(paralysis.getEffects()).singleElement()
        .satisfies(e -> assertThat(e.getCondition().getCode()).isEqualTo(ConditionCode.PARALYZED));
  }

  @Test
  @Transactional
  @DisplayName("escalating failure branches import as separate effects")
  void escalatingFailuresImport() {
    // A Cockatrice's bite Restrains on the first failure and Petrifies on the
    // second; one SAVE_FAILURE branch cannot say that.
    Feature bite = feature(byName("Cockatrice").getStatBlock(), "Petrifying Bite");
    FeatureStep save = bite.getSteps().get(1);
    assertThat(save.getEffects()).extracting(Effect::getOutcome)
        .containsExactly(EffectOutcome.FIRST_FAILURE, EffectOutcome.SECOND_FAILURE);
    assertThat(save.getEffects().getFirst().getCondition().getCode())
        .isEqualTo(ConditionCode.RESTRAINED);
    assertThat(save.getEffects().get(1).getCondition().getCode())
        .isEqualTo(ConditionCode.PETRIFIED);
  }

  private Monster byName(String name) {
    return monsters.findByOwnerIdIsNull().stream()
        .filter(m -> m.getName().equals(name))
        .findFirst()
        .orElseThrow(() -> new AssertionError("not imported: " + name));
  }

  private static FeatureStep onlyStep(Feature f) {
    assertThat(f.getSteps()).hasSize(1);
    return f.getSteps().getFirst();
  }

  private static Feature feature(StatBlock s, String name) {
    return s.getFeatures().stream()
        .filter(f -> f.getName().equals(name))
        .findFirst()
        .orElseThrow(() -> new AssertionError("no feature " + name));
  }
}
