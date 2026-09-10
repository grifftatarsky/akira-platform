package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.MasteryCode;
import jakarta.validation.constraints.NotBlank;

public record WeaponMasteryRequest(@NotBlank String name, MasteryCode code, @NotBlank String description) {}
