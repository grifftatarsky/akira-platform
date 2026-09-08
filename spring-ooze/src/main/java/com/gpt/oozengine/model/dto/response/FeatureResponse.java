package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.Activation;
import com.gpt.oozengine.constant.rules.AreaShape;
import com.gpt.oozengine.constant.rules.UsesReset;
import com.gpt.oozengine.model.mechanics.Feature;
import java.util.List;
import java.util.UUID;

/**
 * One capability. The rolls it makes are in {@link #steps} — usually one, two
 * where the book chains an attack into a follow-up save. {@link #components} is
 * non-empty only for a Multiattack, which makes no rolls of its own and instead
 * names the creature's other actions.
 */
public record FeatureResponse(
    UUID id,
    String name,
    String description,
    Activation activation,
    Integer legendaryCost,
    String triggerText,
    UsesReset usesReset,
    Integer usesMax,
    Integer rechargeMin,
    Integer rechargeMax,
    AreaShape areaShape,
    Integer areaSizeFeet,
    List<FeatureStepResponse> steps,
    List<FeatureComponentResponse> components) {

  public static FeatureResponse from(Feature f) {
    return new FeatureResponse(
        f.getId(),
        f.getName(),
        f.getDescription(),
        f.getActivation(),
        f.getLegendaryCost(),
        f.getTriggerText(),
        f.getUsesReset(),
        f.getUsesMax(),
        f.getRechargeMin(),
        f.getRechargeMax(),
        f.getAreaShape(),
        f.getAreaSizeFeet(),
        f.getSteps().stream().map(FeatureStepResponse::from).toList(),
        f.getComponents().stream().map(FeatureComponentResponse::from).toList());
  }
}
