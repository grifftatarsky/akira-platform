package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.ComponentMode;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/**
 * One line of a Multiattack.
 *
 * <p>References an existing feature by id. A component pointing at a feature
 * created in the same save has no id to point at yet, so that case needs two
 * saves — deliberately, rather than inventing client-side placeholder ids.
 *
 * @param mode how this line combines with the others; defaults to FIXED
 * @param choiceGroup components sharing one are alternatives to each other
 */
public record FeatureComponentRequest(
    UUID id,
    @NotNull UUID referencedFeatureId,
    int count,
    boolean optional,
    ComponentMode mode,
    Integer choiceGroup) {}
