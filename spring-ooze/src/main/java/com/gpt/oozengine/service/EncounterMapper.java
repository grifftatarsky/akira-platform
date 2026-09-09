package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.Disposition;
import com.gpt.oozengine.model.GameCharacter;
import com.gpt.oozengine.model.creature.StatBlock;
import com.gpt.oozengine.model.dto.request.BattleMapRequest;
import com.gpt.oozengine.model.dto.request.CombatantRequest;
import com.gpt.oozengine.model.dto.request.MapCellRequest;
import com.gpt.oozengine.model.encounter.BattleMap;
import com.gpt.oozengine.model.encounter.Combatant;
import com.gpt.oozengine.model.encounter.MapCell;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Requests to entities. Kept out of the service so the service reads as rules. */
public final class EncounterMapper {

  private EncounterMapper() {}

  /**
   * Applies a map request in place.
   *
   * <p>The cell list is replaced wholesale rather than merged. Painting is a
   * whole-canvas operation — a DM who erases a wall sends a list without it, and
   * a merge would have no way to tell that from a list that simply did not
   * mention it.
   */
  public static void apply(BattleMapRequest req, BattleMap map) {
    applyScalars(req, map);
    if (req != null && req.cells() != null) {
      map.getCells().clear();
      map.getCells().addAll(cellsFrom(req, map));
    }
  }

  /** Everything but the painting, so the caller can flush the deletes first. */
  public static void applyScalars(BattleMapRequest req, BattleMap map) {
    if (req == null) {
      return;
    }
    map.setWidth(req.width());
    map.setHeight(req.height());
    map.setCellFeet(req.cellFeet());
    if (req.defaultTerrain() != null) {
      map.setDefaultTerrain(req.defaultTerrain());
    }
    if (req.defaultLight() != null) {
      map.setDefaultLight(req.defaultLight());
    }
  }

  /** The rows a request would paint, validated against the map's bounds. */
  public static List<MapCell> cellsFrom(BattleMapRequest req, BattleMap map) {
    List<MapCell> out = new ArrayList<>();
    if (req == null || req.cells() == null) {
      return out;
    }
    for (MapCellRequest c : req.cells()) {
      if (c.x() >= map.getWidth() || c.y() >= map.getHeight()) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
            "Cell (" + c.x() + ", " + c.y() + ") is off a " + map.getWidth()
                + "x" + map.getHeight() + " map");
      }
      // An entirely blank cell is a row that says nothing; sparse storage exists
      // precisely so those are absent rather than present and empty.
      if (!isBlank(c)) {
        out.add(cell(c));
      }
    }
    return out;
  }

  private static boolean isBlank(MapCellRequest c) {
    return c.elevationFeet() == null && c.terrain() == null && c.light() == null
        && c.cover() == null && c.opaque() == null && c.extraMoveCostFeet() == null
        && (c.notes() == null || c.notes().isBlank());
  }

  /**
   * Stamps a brush onto an existing cell, leaving alone anything the brush does
   * not mention.
   *
   * <p>That is what lets a DM raise the ground across a room without repainting
   * its terrain, and it is why every field of the brush is nullable.
   */
  public static void stamp(MapCellRequest brush, MapCell cell) {
    if (brush.elevationFeet() != null) {
      cell.setElevationFeet(brush.elevationFeet());
    }
    if (brush.terrain() != null) {
      cell.setTerrain(brush.terrain());
    }
    if (brush.light() != null) {
      cell.setLight(brush.light());
    }
    if (brush.cover() != null) {
      cell.setCover(brush.cover());
    }
    if (brush.opaque() != null) {
      cell.setOpaque(brush.opaque());
    }
    if (brush.extraMoveCostFeet() != null) {
      cell.setExtraMoveCostFeet(brush.extraMoveCostFeet());
    }
    if (brush.notes() != null && !brush.notes().isBlank()) {
      cell.setNotes(brush.notes());
    }
  }

  /** A freshly painted square at these coordinates. */
  public static MapCell blank(int x, int y) {
    MapCell cell = new MapCell();
    cell.setX(x);
    cell.setY(y);
    return cell;
  }

  /** True when nothing on the cell differs from the map's defaults. */
  public static boolean isDefault(MapCell c) {
    return c.getElevationFeet() == null && c.getTerrain() == null && c.getLight() == null
        && c.getCover() == null && c.getOpaque() == null && c.getExtraMoveCostFeet() == null
        && (c.getNotes() == null || c.getNotes().isBlank());
  }

  private static MapCell cell(MapCellRequest c) {
    MapCell cell = new MapCell();
    cell.setX(c.x());
    cell.setY(c.y());
    cell.setElevationFeet(c.elevationFeet());
    cell.setTerrain(c.terrain());
    cell.setLight(c.light());
    cell.setCover(c.cover());
    cell.setOpaque(c.opaque());
    cell.setExtraMoveCostFeet(c.extraMoveCostFeet());
    cell.setNotes(c.notes());
    return cell;
  }

  public static BattleMap newMap(BattleMapRequest req) {
    BattleMap map = new BattleMap();
    apply(req, map);
    return map;
  }

  /** Applies a combatant request in place. Bases are resolved by the caller. */
  public static void apply(CombatantRequest req, Combatant c, StatBlock statBlock,
      GameCharacter character) {
    c.setStatBlock(statBlock);
    c.setGameCharacter(character);
    c.setName(req.name());
    c.setX(orZero(req.xHalfFeet()));
    c.setY(orZero(req.yHalfFeet()));
    c.setZ(orZero(req.zHalfFeet()));
    c.setDisposition(req.disposition() == null ? Disposition.ACTIVE : req.disposition());
    c.setSurprised(Boolean.TRUE.equals(req.surprised()));
    c.setMaxHitPoints(req.maxHitPoints());
    c.setSize(req.size());
    c.setNotes(req.notes());
  }

  private static int orZero(Integer v) {
    return v == null ? 0 : v;
  }

  /** Every cell a request would paint, for bounds reporting. */
  public static List<MapCellRequest> cellsOf(BattleMapRequest req) {
    return req == null || req.cells() == null ? List.of() : req.cells();
  }
}
