package com.gpt.oozengine.service;

import com.gpt.oozengine.model.creature.DamageResponse;
import com.gpt.oozengine.model.creature.GearEntry;
import com.gpt.oozengine.model.creature.KnownSpell;
import com.gpt.oozengine.model.creature.SenseRange;
import com.gpt.oozengine.model.creature.SkillBonus;
import com.gpt.oozengine.model.creature.StatBlock;
import com.gpt.oozengine.model.mechanics.DiceRoll;
import com.gpt.oozengine.model.mechanics.Effect;
import com.gpt.oozengine.model.mechanics.Feature;
import com.gpt.oozengine.model.mechanics.FeatureCapability;
import com.gpt.oozengine.model.mechanics.FeatureComponent;
import com.gpt.oozengine.model.mechanics.FeatureStep;
import com.gpt.oozengine.model.mechanics.Rider;
import com.gpt.oozengine.model.mechanics.ShapeOption;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;

/**
 * A deep copy of a stat block, for a DM who wants to change the creature itself.
 *
 * <p>Deep because a shallow one is worse than none: a clone sharing its features
 * with the book means editing the goblin in an encounter edits the goblin in the
 * compendium, which is the exact failure the clone exists to prevent.
 *
 * <p><b>The whole tree comes along</b> — features, their steps, the effects on
 * those steps, the riders on those effects, plus capabilities and shape options.
 * Every one of those was earned in the import, and a clone that dropped riders
 * would produce a copy of a creature that has quietly lost Pack Tactics.
 *
 * <p>Embeddables (skills, senses, gear, known spells) are copied by value
 * because that is what they are; references out to shared catalog rows — a
 * Condition, a Spell, an Item — are shared on purpose. Cloning a creature must
 * not clone the Poisoned condition.
 */
public final class StatBlockCloner {

  private StatBlockCloner() {}

  /** A detached deep copy, ready to be persisted as somebody's private override. */
  public static StatBlock deepCopy(StatBlock source) {
    StatBlock copy = new StatBlock();

    // region Scalars
    copy.setSize(source.getSize());
    copy.setCreatureType(source.getCreatureType());
    copy.setCreatureSubtype(source.getCreatureSubtype());
    copy.setAlignment(source.getAlignment());
    copy.setArmorClass(source.getArmorClass());
    copy.setArmorClassNote(source.getArmorClassNote());
    copy.setInitiativeBonus(source.getInitiativeBonus());
    copy.setHitPoints(copyDice(source.getHitPoints()));
    copy.setCanHover(source.isCanHover());
    copy.setStrength(source.getStrength());
    copy.setDexterity(source.getDexterity());
    copy.setConstitution(source.getConstitution());
    copy.setIntelligence(source.getIntelligence());
    copy.setWisdom(source.getWisdom());
    copy.setCharisma(source.getCharisma());
    copy.setPassivePerception(source.getPassivePerception());
    copy.setLanguages(source.getLanguages());
    copy.setTelepathyFeet(source.getTelepathyFeet());
    copy.setChallengeRating(source.getChallengeRating());
    copy.setExperiencePoints(source.getExperiencePoints());
    copy.setProficiencyBonus(source.getProficiencyBonus());
    copy.setSpellcastingAbility(source.getSpellcastingAbility());
    copy.setSpellSaveDc(source.getSpellSaveDc());
    copy.setSpellAttackBonus(source.getSpellAttackBonus());
    copy.setLegendaryActionUses(source.getLegendaryActionUses());
    copy.setUniqueBehavior(source.getUniqueBehavior());
    // A fresh map: two hydras in one fight lose heads independently, and sharing
    // this one would have them lose the same head twice.
    copy.setUniqueData(source.getUniqueData() == null
        ? null : new LinkedHashMap<>(source.getUniqueData()));
    // endregion

    // region Value collections
    copy.getSpeeds().putAll(source.getSpeeds());
    // putAll, not new EnumMap(map): the copy constructor infers the key type
    // from the map's first entry and throws "Specified map is empty" when there
    // is none — and plenty of creatures have no saving throw bonuses at all.
    copy.getSaveBonuses().putAll(source.getSaveBonuses());
    source.getSkills().forEach(s -> copy.getSkills().add(new SkillBonus(s.getSkill(), s.getBonus())));
    source.getSenses().forEach(
        s -> copy.getSenses().add(new SenseRange(s.getSenseType(), s.getRangeFeet())));
    source.getDamageResponses().forEach(d -> copy.getDamageResponses()
        .add(new DamageResponse(d.getDamageType(), d.getResponse(), d.getQualifier())));
    // Conditions are shared catalog rows: cloning a creature must not clone
    // Poisoned.
    copy.setConditionImmunities(new LinkedHashSet<>(source.getConditionImmunities()));
    source.getKnownSpells().forEach(k -> copy.getKnownSpells().add(
        new KnownSpell(k.getSpell(), k.getSpellLevel(), k.getUsesReset(), k.getUsesMax())));
    source.getGear().forEach(
        g -> copy.getGear().add(new GearEntry(g.getItem(), g.getQuantity())));
    // endregion

    // Features first, so components have clones to point at.
    Map<Feature, Feature> clones = new IdentityHashMap<>();
    for (Feature f : source.getFeatures()) {
      Feature c = copyFeature(f);
      clones.put(f, c);
      copy.getFeatures().add(c);
    }
    // Then the components, remapped onto the clones. Copying a component's
    // reference verbatim would leave the override's Multiattack invoking the
    // *book's* Tentacle — so editing the attack would change nothing, which is
    // the bug that is hardest to see and easiest to write.
    for (Feature f : source.getFeatures()) {
      Feature c = clones.get(f);
      for (FeatureComponent comp : f.getComponents()) {
        FeatureComponent cc = new FeatureComponent();
        cc.setReferencedFeature(clones.get(comp.getReferencedFeature()));
        cc.setReferencedSpell(comp.getReferencedSpell());
        cc.setSpellLevel(comp.getSpellLevel());
        cc.setReferencedAction(comp.getReferencedAction());
        cc.setCount(comp.getCount());
        cc.setOptional(comp.isOptional());
        cc.setMode(comp.getMode());
        cc.setChoiceGroup(comp.getChoiceGroup());
        cc.setOrdinal(comp.getOrdinal());
        // A component whose target was not among this block's features had
        // nothing valid to point at; dropping it beats writing a null target
        // that violates the single-target constraint on insert.
        if (cc.getReferencedFeature() != null || cc.getReferencedSpell() != null
            || cc.getReferencedAction() != null) {
          c.getComponents().add(cc);
        }
      }
    }
    return copy;
  }

  private static Feature copyFeature(Feature f) {
    Feature c = new Feature();
    c.setName(f.getName());
    c.setDescription(f.getDescription());
    c.setOrdinal(f.getOrdinal());
    c.setSubclassId(f.getSubclassId());
    c.setVocationLevel(f.getVocationLevel());
    c.setActivation(f.getActivation());
    c.setLegendaryCost(f.getLegendaryCost());
    c.setActivationTime(f.getActivationTime());
    c.setActivationUnit(f.getActivationUnit());
    c.setTriggerText(f.getTriggerText());
    c.setTriggerEvent(f.getTriggerEvent());
    c.setTriggerDamageType(f.getTriggerDamageType());
    c.setTriggerThreshold(f.getTriggerThreshold());
    c.setAuraSizeFeet(f.getAuraSizeFeet());
    c.setRitual(f.isRitual());
    c.setUsesReset(f.getUsesReset());
    c.setUsesMax(f.getUsesMax());
    c.setRechargeMin(f.getRechargeMin());
    c.setRechargeMax(f.getRechargeMax());
    c.setRangeType(f.getRangeType());
    c.setTargetKind(f.getTargetKind());
    c.setTargetCount(f.getTargetCount());
    c.setTargetFilter(f.getTargetFilter());
    c.setAreaShape(f.getAreaShape());
    c.setAreaSizeFeet(f.getAreaSizeFeet());
    c.setAreaHeightFeet(f.getAreaHeightFeet());

    f.getSteps().forEach(s -> c.getSteps().add(copyStep(s)));
    f.getCapabilities().forEach(cap -> c.getCapabilities().add(copyCapability(cap)));
    f.getShapes().forEach(s -> c.getShapes().add(copyShape(s)));
    return c;
  }

  private static FeatureStep copyStep(FeatureStep s) {
    FeatureStep c = new FeatureStep();
    c.setOrdinal(s.getOrdinal());
    c.setTrigger(s.getTrigger());
    c.setTargetFilter(s.getTargetFilter());
    c.setDelivery(s.getDelivery());
    c.setAttackKind(s.getAttackKind());
    c.setAttackBonus(s.getAttackBonus());
    c.setAttackBonusSource(s.getAttackBonusSource());
    c.setReachFeet(s.getReachFeet());
    c.setRangeFeet(s.getRangeFeet());
    c.setRangeLongFeet(s.getRangeLongFeet());
    c.setSaveAbility(s.getSaveAbility());
    c.setSaveDc(s.getSaveDc());
    c.setSaveDcSource(s.getSaveDcSource());
    s.getEffects().forEach(e -> c.getEffects().add(copyEffect(e)));
    return c;
  }

  private static Effect copyEffect(Effect e) {
    Effect c = new Effect();
    c.setOutcome(e.getOutcome());
    c.setKind(e.getKind());
    c.setOrdinal(e.getOrdinal());
    c.setAmount(copyDice(e.getAmount()));
    c.setDamageType(e.getDamageType());
    c.setHalfDamage(e.isHalfDamage());
    c.setCondition(e.getCondition());
    c.setEscapeDc(e.getEscapeDc());
    c.setRepeatSaveAbility(e.getRepeatSaveAbility());
    c.setDurationAmount(e.getDurationAmount());
    c.setDurationUnit(e.getDurationUnit());
    c.setMovementType(e.getMovementType());
    c.setMovementFeet(e.getMovementFeet());
    c.setNotes(e.getNotes());
    c.setSummonStatBlockId(e.getSummonStatBlockId());
    c.setSummonCount(e.getSummonCount());
    c.setSummonMaxControlled(e.getSummonMaxControlled());
    e.getRiders().forEach(r -> c.getRiders().add(copyRider(r)));
    return c;
  }

  private static Rider copyRider(Rider r) {
    Rider c = new Rider();
    c.setTarget(r.getTarget());
    c.setMode(r.getMode());
    c.setAmount(r.getAmount());
    c.setAmountDice(copyDice(r.getAmountDice()));
    c.setAbility(r.getAbility());
    c.setDamageType(r.getDamageType());
    c.setGate(r.getGate());
    c.setDurationAmount(r.getDurationAmount());
    c.setDurationUnit(r.getDurationUnit());
    c.setRemovedBy(r.getRemovedBy());
    c.setDestroyedAt(r.getDestroyedAt());
    return c;
  }

  private static FeatureCapability copyCapability(FeatureCapability cap) {
    FeatureCapability c = new FeatureCapability();
    c.setCapability(cap.getCapability());
    c.setAmount(cap.getAmount());
    c.setSecondAmount(cap.getSecondAmount());
    c.setDurationUnit(cap.getDurationUnit());
    c.setDamageType(cap.getDamageType());
    c.setNotes(cap.getNotes());
    return c;
  }

  private static ShapeOption copyShape(ShapeOption s) {
    ShapeOption c = new ShapeOption();
    c.setOrdinal(s.getOrdinal());
    c.setName(s.getName());
    c.setSize(s.getSize());
    c.setTrueForm(s.isTrueForm());
    c.getSpeeds().putAll(s.getSpeeds());
    return c;
  }

  /** DiceRoll is an embeddable, so a copy is a new one with the same numbers. */
  private static DiceRoll copyDice(DiceRoll d) {
    return d == null ? null
        : new DiceRoll(d.getCount(), d.getFaces(), d.getBonus(), d.getAverage());
  }
}
