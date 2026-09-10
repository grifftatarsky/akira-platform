package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.CharacterKind;
import com.gpt.oozengine.constant.rules.Alignment;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record CharacterRequest(
    @NotBlank String name,
    @NotNull CharacterKind kind,
    UUID speciesId,
    UUID vocationId,
    UUID subclassId,
    UUID backgroundId,
    Alignment alignment,
    Integer level,
    Integer armorClass,
    Integer hitPointsAverage,
    Integer walkSpeed,
    Integer strength,
    Integer dexterity,
    Integer constitution,
    Integer intelligence,
    Integer wisdom,
    Integer charisma,
    String description,
    String notes) {}
