package com.gpt.oozengine.model.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * A new fight.
 *
 * @param seed supply one to make the fight reproducible on purpose — the same
 *     seed rolls the same battle. Omitted, one is chosen and recorded, so a
 *     battle is reproducible either way and undo always rewinds into the same
 *     fight rather than a new one.
 */
public record BattleRequest(
    @NotBlank @Size(max = 200) String name,
    Long seed) {}
