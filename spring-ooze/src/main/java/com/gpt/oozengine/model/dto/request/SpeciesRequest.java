package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.CreatureType;
import jakarta.validation.constraints.NotBlank;

public record SpeciesRequest(
    @NotBlank String name,
    CreatureSize size,
    CreatureSize alternateSize,
    CreatureType creatureType,
    Integer walkSpeed,
    String description) {}
