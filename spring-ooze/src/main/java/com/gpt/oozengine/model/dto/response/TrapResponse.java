package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.constant.rules.TrapSeverity;
import com.gpt.oozengine.model.Trap;
import java.util.UUID;

public record TrapResponse(
    UUID id,
    String name,
    TrapSeverity severity,
    String levelBand,
    String severityNote,
    String trigger,
    String duration,
    String description,
    boolean base,
    UUID overridesId,
    SrdVersion srdVersion) {

  public static TrapResponse from(Trap t) {
    return new TrapResponse(
        t.getId(), t.getName(), t.getSeverity(), t.getLevelBand(), t.getSeverityNote(),
        t.getTrigger(), t.getDuration(), t.getDescription(), t.isBaseContent(),
        t.getOverridesId(), t.getSrdVersion());
  }
}
