package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.ArmorCategory;
import com.gpt.oozengine.constant.rules.CasterProgression;
import com.gpt.oozengine.constant.rules.Skill;
import com.gpt.oozengine.model.Vocation;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** A class. Collections are copied out of the session — see {@link BackgroundResponse}. */
public record VocationResponse(
    UUID id,
    String name,
    Integer hitDie,
    Set<Ability> primaryAbilities,
    Set<Ability> savingThrowProficiencies,
    CasterProgression casterProgression,
    Ability spellcastingAbility,
    Set<Skill> skillOptions,
    Integer skillChoices,
    Set<ArmorCategory> armorTraining,
    String weaponProficiencies,
    String toolProficiencies,
    String startingEquipment,
    String likes,
    String complexity,
    String description,
    List<VocationLevelResponse> levels,
    List<FeatureResponse> features,
    List<SubclassResponse> subclasses,
    boolean base,
    UUID overridesId,
    SrdVersion srdVersion) {

  /** A list row: the header, without the twenty levels and the features. */
  public static VocationResponse summary(Vocation v) {
    return build(v, List.of(), List.of(), List.of());
  }

  public static VocationResponse from(Vocation v, List<SubclassResponse> subclasses) {
    return build(v, v.getLevels().stream().map(VocationLevelResponse::from).toList(),
        v.getFeatures().stream().map(FeatureResponse::from).toList(), subclasses);
  }

  private static VocationResponse build(
      Vocation v,
      List<VocationLevelResponse> levels,
      List<FeatureResponse> features,
      List<SubclassResponse> subclasses) {
    return new VocationResponse(
        v.getId(),
        v.getName(),
        v.getHitDie(),
        Set.copyOf(v.getPrimaryAbilities()),
        Set.copyOf(v.getSavingThrowProficiencies()),
        v.getCasterProgression(),
        v.getSpellcastingAbility(),
        Set.copyOf(v.getSkillOptions()),
        v.getSkillChoices(),
        Set.copyOf(v.getArmorTraining()),
        v.getWeaponProficiencies(),
        v.getToolProficiencies(),
        v.getStartingEquipment(),
        v.getLikes(),
        v.getComplexity(),
        v.getDescription(),
        levels,
        features,
        subclasses,
        v.isBaseContent(),
        v.getOverridesId(),
        v.getSrdVersion());
  }
}
