package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.Alignment;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.CreatureType;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.model.creature.StatBlock;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/**
 * The structured half of a monster or character: everything the simulator reads.
 *
 * <p>The flat fields on {@link MonsterResponse} are a rendering of some of this
 * for the finder's generic detail pane. This is the authoritative shape, and the
 * one an importer and the encounter engine talk to.
 */
public record StatBlockResponse(
    UUID id,
    CreatureSize size,
    CreatureType creatureType,
    String creatureSubtype,
    Alignment alignment,
    Integer armorClass,
    String armorClassNote,
    Integer initiativeBonus,
    Integer hitPointsAverage,
    String hitPointsDice,
    Map<MovementType, Integer> speeds,
    boolean canHover,
    Map<Ability, Integer> abilityScores,
    Map<Ability, Integer> saveBonuses,
    Map<String, Integer> skills,
    Map<String, Integer> senses,
    Integer passivePerception,
    List<String> damageResponses,
    List<String> conditionImmunities,
    String languages,
    Integer telepathyFeet,
    BigDecimal challengeRating,
    Integer experiencePoints,
    Integer proficiencyBonus,
    Ability spellcastingAbility,
    Integer spellSaveDc,
    Integer spellAttackBonus,
    Integer legendaryActionUses,
    List<FeatureResponse> features,
    List<KnownSpellResponse> knownSpells) {

  public static StatBlockResponse from(StatBlock s) {
    if (s == null) {
      return null;
    }
    Map<Ability, Integer> scores = new TreeMap<>();
    for (Ability a : Ability.values()) {
      Integer score =
          switch (a) {
            case STRENGTH -> s.getStrength();
            case DEXTERITY -> s.getDexterity();
            case CONSTITUTION -> s.getConstitution();
            case INTELLIGENCE -> s.getIntelligence();
            case WISDOM -> s.getWisdom();
            case CHARISMA -> s.getCharisma();
          };
      if (score != null) {
        scores.put(a, score);
      }
    }
    Map<String, Integer> skills = new TreeMap<>();
    s.getSkills().forEach(sb -> skills.put(sb.getSkill().name(), sb.getBonus()));
    Map<String, Integer> senses = new TreeMap<>();
    s.getSenses().forEach(sr -> senses.put(sr.getSenseType().name(), sr.getRangeFeet()));
    return new StatBlockResponse(
        s.getId(),
        s.getSize(),
        s.getCreatureType(),
        s.getCreatureSubtype(),
        s.getAlignment(),
        s.getArmorClass(),
        s.getArmorClassNote(),
        s.getInitiativeBonus(),
        s.getHitPoints() == null ? null : s.getHitPoints().getAverage(),
        s.getHitPoints() == null ? null : s.getHitPoints().expression(),
        new TreeMap<>(s.getSpeeds()),
        s.isCanHover(),
        scores,
        new TreeMap<>(s.getSaveBonuses()),
        skills,
        senses,
        s.getPassivePerception(),
        s.getDamageResponses().stream()
            .map(d -> d.getResponse() + " " + d.getDamageType()
                + (d.getQualifier() == null ? "" : " (" + d.getQualifier() + ")"))
            .toList(),
        s.getConditionImmunities().stream().map(c -> c.getName()).sorted().toList(),
        s.getLanguages(),
        s.getTelepathyFeet(),
        s.getChallengeRating(),
        s.getExperiencePoints(),
        s.getProficiencyBonus(),
        s.getSpellcastingAbility(),
        s.getSpellSaveDc(),
        s.getSpellAttackBonus(),
        s.getLegendaryActionUses(),
        s.getFeatures().stream().map(FeatureResponse::from).toList(),
        s.getKnownSpells().stream().map(KnownSpellResponse::from).toList());
  }
}
