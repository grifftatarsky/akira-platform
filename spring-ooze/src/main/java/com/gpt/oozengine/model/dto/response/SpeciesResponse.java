package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.CreatureType;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.model.Species;
import java.util.List;
import java.util.UUID;

public record SpeciesResponse(
    UUID id,
    String name,
    CreatureSize size,
    CreatureSize alternateSize,
    CreatureType creatureType,
    Integer walkSpeed,
    String description,
    List<FeatureResponse> features,
    boolean base,
    UUID overridesId,
    SrdVersion srdVersion) {

  public static SpeciesResponse from(Species s) {
    return new SpeciesResponse(
        s.getId(),
        s.getName(),
        s.getSize(),
        s.getAlternateSize(),
        s.getCreatureType(),
        s.getSpeeds().get(MovementType.WALK),
        s.getDescription(),
        s.getFeatures().stream().map(FeatureResponse::from).toList(),
        s.isBaseContent(),
        s.getOverridesId(),
        s.getSrdVersion());
  }
}
