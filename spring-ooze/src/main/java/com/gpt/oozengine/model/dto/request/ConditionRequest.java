package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.ConditionCode;
import jakarta.validation.constraints.NotBlank;

public record ConditionRequest(@NotBlank String name, ConditionCode code, @NotBlank String description) {}
