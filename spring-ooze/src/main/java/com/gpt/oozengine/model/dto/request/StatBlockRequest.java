package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.Alignment;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.CreatureType;
import com.gpt.oozengine.constant.rules.DamageResponseKind;
import com.gpt.oozengine.constant.rules.DamageType;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.constant.rules.SenseType;
import com.gpt.oozengine.constant.rules.Skill;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * A whole stat block, in the order the book prints one.
 *
 * <p>Collections are replace-all: what the client sends is what the block ends
 * up with. Features are the exception and are matched on id, because a feature's
 * identity is referenced by Multiattack components and by anything the simulator
 * has recorded against it.
 */
public record StatBlockRequest(
    CreatureSize size,
    CreatureType creatureType,
    String creatureSubtype,
    Alignment alignment,
    Integer armorClass,
    String armorClassNote,
    Integer initiativeBonus,
    Integer hitPointsAverage,
    Integer hitPointsDiceCount,
    Integer hitPointsDiceFaces,
    Integer hitPointsDiceBonus,
    Map<MovementType, Integer> speeds,
    boolean canHover,
    Integer strength,
    Integer dexterity,
    Integer constitution,
    Integer intelligence,
    Integer wisdom,
    Integer charisma,
    Map<Ability, Integer> saveBonuses,
    Map<Skill, Integer> skills,
    Map<SenseType, Integer> senses,
    Integer passivePerception,
    List<DamageResponseEntry> damageResponses,
    Set<UUID> conditionImmunityIds,
    String languages,
    Integer telepathyFeet,
    BigDecimal challengeRating,
    Integer experiencePoints,
    Integer proficiencyBonus,
    Ability spellcastingAbility,
    Integer spellSaveDc,
    Integer spellAttackBonus,
    Integer legendaryActionUses,
    @Valid List<FeatureRequest> features,
    List<KnownSpellRequest> knownSpells) {

  /** One resistance, immunity or vulnerability. */
  public record DamageResponseEntry(
      DamageType damageType, DamageResponseKind response, String qualifier) {}
}
