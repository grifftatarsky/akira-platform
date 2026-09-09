package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.LightLevel;
import com.gpt.oozengine.constant.rules.TerrainKind;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.List;

/**
 * The battlefield and its painted squares.
 *
 * <p>{@code cells} is the whole painting, not a patch: sending it replaces what
 * is there. A board is at most 60x60 squares and only the painted ones are
 * stored, so the list is small enough to send whole, and replacing it wholesale
 * means the client never has to reason about which squares it just cleared.
 *
 * @param cellFeet the resolution of the terrain, not of placement — tokens sit
 *     at continuous positions and merely sample the raster underneath
 */
public record BattleMapRequest(
    @Min(1) @Max(60) int width,
    @Min(1) @Max(60) int height,
    @Min(1) @Max(20) int cellFeet,
    TerrainKind defaultTerrain,
    LightLevel defaultLight,
    @Valid List<MapCellRequest> cells) {}
