package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.Activation;
import com.gpt.oozengine.constant.rules.AreaShape;
import com.gpt.oozengine.constant.rules.RangeType;
import com.gpt.oozengine.constant.rules.TargetKind;
import com.gpt.oozengine.constant.rules.TimeUnit;
import com.gpt.oozengine.constant.rules.UsesReset;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.UUID;

/** One capability being created or edited. See {@link EffectRequest} on ids. */
public record FeatureRequest(
    UUID id,
    @NotBlank String name,
    String description,
    Activation activation,
    Integer legendaryCost,
    Integer activationTime,
    TimeUnit activationUnit,
    String triggerText,
    boolean ritual,
    UsesReset usesReset,
    Integer usesMax,
    Integer rechargeMin,
    Integer rechargeMax,
    RangeType rangeType,
    TargetKind targetKind,
    Integer targetCount,
    String targetFilter,
    AreaShape areaShape,
    Integer areaSizeFeet,
    Integer areaHeightFeet,
    @Valid List<FeatureStepRequest> steps,
    @Valid List<FeatureComponentRequest> components) {}
