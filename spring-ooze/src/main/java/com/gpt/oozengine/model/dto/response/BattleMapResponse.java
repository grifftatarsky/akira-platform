package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.LightLevel;
import com.gpt.oozengine.constant.rules.TerrainKind;
import com.gpt.oozengine.model.encounter.BattleMap;
import com.gpt.oozengine.model.encounter.MapProp;
import java.util.List;
import java.util.UUID;

/**
 * The battlefield: only the squares that differ from its defaults, and all of
 * its furniture.
 *
 * <p>{@link MapProp} is handed back as itself rather than copied into a
 * response record. It is already exactly the API's shape — five scalars, no
 * associations, nothing lazy — because it is a value inside a JSON column and
 * not an entity, so a {@code MapPropResponse.from} would be five assignments
 * that can only ever drift.
 */
public record BattleMapResponse(
    UUID id,
    int width,
    int height,
    int cellFeet,
    TerrainKind defaultTerrain,
    LightLevel defaultLight,
    List<MapCellResponse> cells,
    List<MapProp> props) {

  public static BattleMapResponse from(BattleMap m) {
    return new BattleMapResponse(m.getId(), m.getWidth(), m.getHeight(), m.getCellFeet(),
        m.getDefaultTerrain(), m.getDefaultLight(),
        m.getCells().stream().map(MapCellResponse::from).toList(),
        List.copyOf(m.getProps()));
  }
}
