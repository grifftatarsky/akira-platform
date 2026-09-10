package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.FeatCategory;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record FeatRequest(
    @NotBlank String name,
    @NotNull FeatCategory category,
    String prerequisite,
    boolean repeatable,
    @NotBlank String description) {}
