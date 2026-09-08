package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.GlossaryCategory;
import jakarta.validation.constraints.NotBlank;

public record GlossaryEntryRequest(
    @NotBlank String name, GlossaryCategory category, @NotBlank String description) {}
