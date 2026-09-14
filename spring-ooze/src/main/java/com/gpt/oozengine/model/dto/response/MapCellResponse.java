package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.CoverDegree;
import com.gpt.oozengine.constant.rules.LightLevel;
import com.gpt.oozengine.constant.rules.TerrainKind;
import com.gpt.oozengine.model.encounter.MapCell;

/** One painted square, exactly as stored: nulls mean "the map's default". */
public record MapCellResponse(
    int x,
    int y,
    Integer elevationFeet,
    TerrainKind terrain,
    LightLevel light,
    CoverDegree cover,
    Boolean opaque,
    Integer extraMoveCostFeet,
    String notes) {

  public static MapCellResponse from(MapCell c) {
    return new MapCellResponse(c.getX(), c.getY(), c.getElevationFeet(), c.getTerrain(),
        c.getLight(), c.getCover(), c.getOpaque(), c.getExtraMoveCostFeet(), c.getNotes());
  }
}
