package com.gpt.oozengine.model.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * A saved setup.
 *
 * <p>{@code map} is nullable on create, giving a default 20x20 board at 5 feet a
 * square — a DM who wants to drop monsters somewhere and think about terrain
 * later should not have to describe a board first.
 */
public record EncounterRequest(
    @NotBlank @Size(max = 200) String name,
    String description,
    @Valid BattleMapRequest map) {}
