package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.PropKind;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * One piece of furniture to stand on the board.
 *
 * <p>Positions are in half-feet and continuous, like a creature's rather than
 * like a painted square's cell index: furniture is placed, not rastered, and a
 * table across the middle of two squares is a thing a DM should be able to do.
 *
 * <p>Height and facing are boxed and default to zero, for the reason a
 * combatant's coordinates are: standing something on the floor facing north is
 * the overwhelmingly common case, Jackson maps an omitted field to null, and a
 * primitive rejects that — so requiring {@code "zHalfFeet": 0} on every barrel
 * would make a 400 out of the most ordinary request there is.
 */
public record MapPropRequest(
    @NotNull PropKind piece,
    @PositiveOrZero int xHalfFeet,
    @PositiveOrZero int yHalfFeet,
    @Min(0) Integer zHalfFeet,
    @Min(0) @Max(359) Integer facingDegrees) {}
