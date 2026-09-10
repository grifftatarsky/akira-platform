package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.model.Subclass;
import java.util.UUID;

/**
 * A class's subclass. Its features are not here: they are the class's features
 * carrying this subclass's id, which is what lets a character's feature list be
 * one query with an optional filter rather than two lists merged by hand.
 */
public record SubclassResponse(
    UUID id, String name, String description, boolean base, UUID overridesId,
    SrdVersion srdVersion) {

  public static SubclassResponse from(Subclass s) {
    return new SubclassResponse(
        s.getId(), s.getName(), s.getDescription(), s.isBaseContent(), s.getOverridesId(),
        s.getSrdVersion());
  }
}
