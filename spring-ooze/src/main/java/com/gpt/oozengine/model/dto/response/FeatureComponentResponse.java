package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.ComponentMode;
import com.gpt.oozengine.model.mechanics.FeatureComponent;
import java.util.UUID;

/**
 * One line of a Multiattack: which of the creature's own actions it makes, how
 * many, and how that combines with the other lines.
 *
 * <p>Carries the referenced feature's name rather than the feature, so a stat
 * block's JSON stays a tree — a Multiattack that embedded its Claw would embed
 * the Claw's steps and effects a second time.
 */
public record FeatureComponentResponse(
    UUID id,
    UUID referencedFeatureId,
    String referencedFeatureName,
    int count,
    boolean optional,
    ComponentMode mode,
    Integer choiceGroup) {

  public static FeatureComponentResponse from(FeatureComponent c) {
    return new FeatureComponentResponse(
        c.getId(),
        c.getReferencedFeature().getId(),
        c.getReferencedFeature().getName(),
        c.getCount(),
        c.isOptional(),
        c.getMode(),
        c.getChoiceGroup());
  }
}
