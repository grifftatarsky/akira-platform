package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.AmendmentKind;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;

/**
 * A reaction taken during a window, and what it does to the action in flight.
 *
 * @param reactionName what the DM is calling it — free text, because the engine
 *     does not judge whether a Parry applies to a spell and should not pretend
 *     to by demanding a feature id
 * @param newTargetIds for {@link AmendmentKind#RETARGET}: who is hit instead
 * @param armorClassDelta for {@link AmendmentKind#MODIFY_DEFENCE}: Shield's +5,
 *     Parry's +2, applied to this action and no other
 */
public record ReactionRequest(
    @NotBlank String reactionName,
    @NotNull AmendmentKind kind,
    List<UUID> newTargetIds,
    Integer armorClassDelta,
    String reason) {}
