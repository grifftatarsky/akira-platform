package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.Activation;
import com.gpt.oozengine.constant.rules.UsesReset;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;

/**
 * A class feature.
 *
 * <p>Far smaller than a creature's {@link FeatureRequest}: a class feature makes
 * no attack of its own, so it carries no steps and no effects — what it does is
 * prose, and the level it is gained at is the part that has to be structured.
 *
 * @param id matched to keep a feature's identity across an edit; null creates
 * @param subclassId set for a subclass's features, null for the base class's
 */
public record VocationFeatureRequest(
    UUID id,
    @NotBlank String name,
    String description,
    Integer vocationLevel,
    UUID subclassId,
    Activation activation,
    UsesReset usesReset) {}
