package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.AttackKind;
import com.gpt.oozengine.constant.rules.Delivery;
import com.gpt.oozengine.constant.rules.StepTrigger;
import com.gpt.oozengine.model.mechanics.FeatureStep;
import java.util.List;
import java.util.UUID;

/** One roll in a feature's resolution, with its outcome branches. */
public record FeatureStepResponse(
    UUID id,
    int ordinal,
    StepTrigger trigger,
    String targetFilter,
    Delivery delivery,
    AttackKind attackKind,
    Integer attackBonus,
    Integer reachFeet,
    Integer rangeFeet,
    Integer rangeLongFeet,
    Ability saveAbility,
    Integer saveDc,
    List<EffectResponse> effects) {

  public static FeatureStepResponse from(FeatureStep s) {
    return new FeatureStepResponse(
        s.getId(),
        s.getOrdinal(),
        s.getTrigger(),
        s.getTargetFilter(),
        s.getDelivery(),
        s.getAttackKind(),
        s.getAttackBonus(),
        s.getReachFeet(),
        s.getRangeFeet(),
        s.getRangeLongFeet(),
        s.getSaveAbility(),
        s.getSaveDc(),
        s.getEffects().stream().map(EffectResponse::from).toList());
  }
}
