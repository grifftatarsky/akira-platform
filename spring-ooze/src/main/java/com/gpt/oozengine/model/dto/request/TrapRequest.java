package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.TrapSeverity;
import jakarta.validation.constraints.NotBlank;

public record TrapRequest(
    @NotBlank String name,
    TrapSeverity severity,
    String levelBand,
    String severityNote,
    String trigger,
    String duration,
    @NotBlank String description) {}
