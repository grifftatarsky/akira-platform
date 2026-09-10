package com.gpt.oozengine.model.dto.request;

import jakarta.validation.constraints.NotNull;

/**
 * Damage or healing.
 *
 * @param delta negative for damage, positive for healing. One field rather than
 *     two verbs, because the log wants the signed number anyway and a "heal" of
 *     minus seven is a bug the type can prevent from meaning something.
 */
public record HitPointChangeRequest(@NotNull Integer delta, String reason) {}
