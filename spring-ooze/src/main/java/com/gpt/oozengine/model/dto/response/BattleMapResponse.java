package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.LightLevel;
import com.gpt.oozengine.constant.rules.TerrainKind;
import com.gpt.oozengine.model.encounter.BattleMap;
import java.util.List;
import java.util.UUID;

/** The battlefield and only the squares that differ from its defaults. */
public record BattleMapResponse(
    UUID id,
    int width,
    int height,
    int cellFeet,
    TerrainKind defaultTerrain,
    LightLevel defaultLight,
    List<MapCellResponse> cells) {

  public static BattleMapResponse from(BattleMap m) {
    return new BattleMapResponse(m.getId(), m.getWidth(), m.getHeight(), m.getCellFeet(),
        m.getDefaultTerrain(), m.getDefaultLight(),
        m.getCells().stream().map(MapCellResponse::from).toList());
  }
}
