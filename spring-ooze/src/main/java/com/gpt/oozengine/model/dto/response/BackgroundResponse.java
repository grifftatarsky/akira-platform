package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.Skill;
import com.gpt.oozengine.model.Background;
import java.util.Set;
import java.util.UUID;

/**
 * A background.
 *
 * <p>The collections are copied, not referenced. Handing Jackson a managed
 * Hibernate collection works right up until {@code open-in-view: false} closes
 * the session before serialisation, which is exactly what it does here.
 */
public record BackgroundResponse(
    UUID id,
    String name,
    Set<Ability> abilityScores,
    UUID featId,
    String featName,
    String featNote,
    Set<Skill> skillProficiencies,
    String toolProficiencies,
    String equipment,
    String description,
    boolean base,
    UUID overridesId,
    SrdVersion srdVersion) {

  public static BackgroundResponse from(Background b) {
    return new BackgroundResponse(
        b.getId(),
        b.getName(),
        Set.copyOf(b.getAbilityScores()),
        b.getFeat() == null ? null : b.getFeat().getId(),
        b.getFeat() == null ? null : b.getFeat().getName(),
        b.getFeatNote(),
        Set.copyOf(b.getSkillProficiencies()),
        b.getToolProficiencies(),
        b.getEquipment(),
        b.getDescription(),
        b.isBaseContent(),
        b.getOverridesId(),
        b.getSrdVersion());
  }
}
