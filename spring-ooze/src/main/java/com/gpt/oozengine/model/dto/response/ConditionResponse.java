package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.constant.rules.ConditionCode;
import com.gpt.oozengine.model.Condition;
import java.util.UUID;

public record ConditionResponse(
    UUID id,
    String name,
    String description,
    ConditionCode code,
    boolean base,
    UUID overridesId,
    SrdVersion srdVersion) {

  public static ConditionResponse from(Condition c) {
    return new ConditionResponse(
        c.getId(),
        c.getName(),
        c.getDescription(),
        c.getCode(),
        c.isBaseContent(),
        c.getOverridesId(),
        c.getSrdVersion());
  }
}
