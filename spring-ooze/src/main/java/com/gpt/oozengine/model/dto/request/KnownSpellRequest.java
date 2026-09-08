package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.UsesReset;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/**
 * A spell a creature can cast, and on what allowance.
 *
 * <p>{@code spellLevel} is the level it is cast at, which the book sometimes
 * raises above the spell's own — a dragon's "Acid Arrow (level 4 version)".
 * Null takes the spell's own level.
 */
public record KnownSpellRequest(
    @NotNull UUID spellId, Integer spellLevel, UsesReset usesReset, Integer usesMax) {}
