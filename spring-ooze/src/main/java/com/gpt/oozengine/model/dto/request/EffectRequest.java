package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.DamageType;
import com.gpt.oozengine.constant.rules.EffectKind;
import com.gpt.oozengine.constant.rules.EffectOutcome;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.constant.rules.TimeUnit;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/**
 * One branch of a feature's resolution.
 *
 * <p>{@code id} is present when the client is editing an effect that already
 * exists and absent when it is adding one; the service matches on it so that
 * saving a stat block doesn't churn every row's identity.
 */
public record EffectRequest(
    UUID id,
    @NotNull EffectOutcome outcome,
    @NotNull EffectKind kind,
    Integer diceCount,
    Integer diceFaces,
    Integer diceBonus,
    Integer diceAverage,
    DamageType damageType,
    boolean halfDamage,
    UUID conditionId,
    Integer escapeDc,
    Ability repeatSaveAbility,
    Integer durationAmount,
    TimeUnit durationUnit,
    MovementType movementType,
    Integer movementFeet,
    String notes) {}
