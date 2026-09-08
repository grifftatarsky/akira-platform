package com.gpt.oozengine.model.dto.request;

import jakarta.validation.constraints.NotBlank;

/**
 * One of a class table's own columns at one level — "Rages", "2".
 *
 * <p>A list rather than a map because the order is the book's: a Barbarian's
 * table reads Rages, then Rage Damage, then Weapon Mastery.
 */
public record ClassValueRequest(@NotBlank String label, @NotBlank String value) {}
