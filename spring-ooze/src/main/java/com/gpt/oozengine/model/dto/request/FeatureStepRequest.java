package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.AttackKind;
import com.gpt.oozengine.constant.rules.Delivery;
import com.gpt.oozengine.constant.rules.StepTrigger;
import com.gpt.oozengine.constant.rules.ValueSource;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

/** One roll being created or edited. See {@link EffectRequest} on ids. */
public record FeatureStepRequest(
    UUID id,
    StepTrigger trigger,
    String targetFilter,
    Delivery delivery,
    AttackKind attackKind,
    Integer attackBonus,
    ValueSource attackBonusSource,
    Integer reachFeet,
    Integer rangeFeet,
    Integer rangeLongFeet,
    Ability saveAbility,
    Integer saveDc,
    ValueSource saveDcSource,
    @Valid List<EffectRequest> effects) {}
