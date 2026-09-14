package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.constant.rules.GlossaryCategory;
import com.gpt.oozengine.model.GlossaryEntry;
import java.util.UUID;

public record GlossaryEntryResponse(
    UUID id,
    String name,
    GlossaryCategory category,
    String description,
    boolean base,
    UUID overridesId,
    SrdVersion srdVersion) {

  public static GlossaryEntryResponse from(GlossaryEntry g) {
    return new GlossaryEntryResponse(
        g.getId(), g.getName(), g.getCategory(), g.getDescription(), g.isBaseContent(),
        g.getOverridesId(), g.getSrdVersion());
  }
}
