package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.DamageType;
import com.gpt.oozengine.constant.rules.EffectKind;
import com.gpt.oozengine.constant.rules.EffectOutcome;
import com.gpt.oozengine.model.mechanics.Effect;
import java.util.UUID;

/** One branch of a feature's resolution. */
public record EffectResponse(
    UUID id,
    EffectOutcome outcome,
    EffectKind kind,
    String amount,
    Integer average,
    DamageType damageType,
    boolean halfDamage,
    UUID conditionId,
    String conditionName,
    Integer escapeDc,
    String notes) {

  public static EffectResponse from(Effect e) {
    return new EffectResponse(
        e.getId(),
        e.getOutcome(),
        e.getKind(),
        e.getAmount() == null ? null : e.getAmount().expression(),
        e.getAmount() == null ? null : e.getAmount().getAverage(),
        e.getDamageType(),
        e.isHalfDamage(),
        e.getCondition() == null ? null : e.getCondition().getId(),
        e.getCondition() == null ? null : e.getCondition().getName(),
        e.getEscapeDc(),
        e.getNotes());
  }
}
