package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.CoverDegree;
import com.gpt.oozengine.constant.rules.LightLevel;
import com.gpt.oozengine.constant.rules.TerrainKind;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * One painted square. Every field but the coordinates is nullable and means
 * "leave it at the map's default", which is also why an unpainted square has no
 * row at all.
 *
 * @param x cell index, not a distance
 * @param extraMoveCostFeet extra feet to enter, on top of the usual cell cost;
 *     the static half of Difficult Terrain only — occupancy is worked out at
 *     move time and can never be stored here
 */
public record MapCellRequest(
    @PositiveOrZero int x,
    @PositiveOrZero int y,
    Integer elevationFeet,
    TerrainKind terrain,
    LightLevel light,
    CoverDegree cover,
    Boolean opaque,
    @Min(0) Integer extraMoveCostFeet,
    String notes) {}
