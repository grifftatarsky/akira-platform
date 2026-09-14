package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.Skill;
import jakarta.validation.constraints.NotBlank;
import java.util.Set;
import java.util.UUID;

public record BackgroundRequest(
    @NotBlank String name,
    Set<Ability> abilityScores,
    UUID featId,
    String featNote,
    Set<Skill> skillProficiencies,
    String toolProficiencies,
    String equipment,
    @NotBlank String description) {}
