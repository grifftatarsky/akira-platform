package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.constant.rules.FeatCategory;
import com.gpt.oozengine.model.Feat;
import java.util.List;
import java.util.UUID;

public record FeatResponse(
    UUID id,
    String name,
    FeatCategory category,
    String prerequisite,
    boolean repeatable,
    String description,
    List<FeatureResponse> features,
    boolean base,
    UUID overridesId,
    SrdVersion srdVersion) {

  public static FeatResponse from(Feat f) {
    return new FeatResponse(
        f.getId(),
        f.getName(),
        f.getCategory(),
        f.getPrerequisite(),
        f.isRepeatable(),
        f.getDescription(),
        f.getFeatures().stream().map(FeatureResponse::from).toList(),
        f.isBaseContent(),
        f.getOverridesId(),
        f.getSrdVersion());
  }
}
