package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.Capability;
import com.gpt.oozengine.constant.rules.CoverDegree;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.LightLevel;
import com.gpt.oozengine.constant.rules.TerrainKind;
import com.gpt.oozengine.model.encounter.BattleMap;
import com.gpt.oozengine.model.encounter.MapCell;
import com.gpt.oozengine.model.mechanics.DiceRoll;
import com.gpt.oozengine.util.Falling;
import com.gpt.oozengine.util.Geometry;
import com.gpt.oozengine.util.Geometry.Footprint;
import com.gpt.oozengine.util.Geometry.Point;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * A board, answering questions about itself.
 *
 * <p><b>Everything is computed live.</b> Nothing here is cached, deliberately:
 * we do not yet know where the hot paths are, and one of these answers cannot be
 * cached at all. A square is Difficult Terrain when it contains "a creature that
 * isn't Tiny or your ally", so the cost of entering it depends on who is
 * standing there right now <em>and on who is asking</em>. A cached cost would be
 * wrong for the next creature to look.
 *
 * <p>Cells are read through a map built once per instance, so a board is cheap
 * to construct and cheap to interrogate; construct one per request and throw it
 * away.
 */
public final class Battlefield {

  private final BattleMap map;
  private final Map<Long, MapCell> cells = new HashMap<>();

  public Battlefield(BattleMap map, List<MapCell> painted) {
    this.map = map;
    for (MapCell c : painted) {
      cells.put(key(c.getX(), c.getY()), c);
    }
  }

  private static long key(int x, int y) {
    return ((long) x << 32) ^ (y & 0xffffffffL);
  }

  /** Half-feet across one cell. */
  private int cellHalfFeet() {
    return map.getCellFeet() * 2;
  }

  /** Which cell a continuous position sits in. */
  public int cellX(int xHalfFeet) {
    return Math.floorDiv(xHalfFeet, cellHalfFeet());
  }

  public int cellY(int yHalfFeet) {
    return Math.floorDiv(yHalfFeet, cellHalfFeet());
  }

  private MapCell at(int cx, int cy) {
    return cells.get(key(cx, cy));
  }

  public boolean inBounds(int cx, int cy) {
    return cx >= 0 && cy >= 0 && cx < map.getWidth() && cy < map.getHeight();
  }

  // region Sampling — a null cell means "the map's default"
  public TerrainKind terrainAt(int cx, int cy) {
    MapCell c = at(cx, cy);
    return c == null || c.getTerrain() == null ? map.getDefaultTerrain() : c.getTerrain();
  }

  public LightLevel lightAt(int cx, int cy) {
    MapCell c = at(cx, cy);
    return c == null || c.getLight() == null ? map.getDefaultLight() : c.getLight();
  }

  public int elevationAt(int cx, int cy) {
    MapCell c = at(cx, cy);
    return c == null || c.getElevationFeet() == null ? 0 : c.getElevationFeet();
  }

  /**
   * Whether this square blocks sight. An explicit {@code opaque} wins; otherwise
   * a wall blocks and nothing else does.
   */
  public boolean opaqueAt(int cx, int cy) {
    if (!inBounds(cx, cy)) {
      return true;
    }
    MapCell c = at(cx, cy);
    if (c != null && c.getOpaque() != null) {
      return c.getOpaque();
    }
    return terrainAt(cx, cy) == TerrainKind.WALL;
  }

  public CoverDegree coverAt(int cx, int cy) {
    MapCell c = at(cx, cy);
    if (c != null && c.getCover() != null) {
      return c.getCover();
    }
    return terrainAt(cx, cy) == TerrainKind.WALL ? CoverDegree.TOTAL : CoverDegree.NONE;
  }
  // endregion

  /**
   * Extra feet it costs to enter this square, before anything standing in it.
   *
   * <p>Difficult Terrain is not cumulative, per the book, so this is the cost of
   * the square rather than a sum of reasons it is rough.
   */
  public int staticExtraCost(int cx, int cy) {
    MapCell c = at(cx, cy);
    if (c != null && c.getExtraMoveCostFeet() != null) {
      return c.getExtraMoveCostFeet();
    }
    return switch (terrainAt(cx, cy)) {
      case RUBBLE, WATER, MUD, WEB, ICE -> map.getCellFeet();
      default -> 0;
    };
  }

  /**
   * What it costs {@code mover} to enter this square right now, in feet.
   *
   * <p>The dynamic half of Difficult Terrain: "A creature that isn't Tiny or
   * your ally" makes a space difficult, so this needs the occupants and needs to
   * know which of them the mover counts as allies. Not cumulative with the
   * static cost — a square is difficult or it is not.
   */
  public int enterCost(int cx, int cy, CreatureSize moverSize, List<Occupant> occupants) {
    int base = map.getCellFeet();
    boolean difficult = staticExtraCost(cx, cy) > 0;
    if (!difficult) {
      for (Occupant o : occupants) {
        if (!o.ally() && o.size() != CreatureSize.TINY) {
          difficult = true;
          break;
        }
      }
    }
    return difficult ? base * 2 : base;
  }

  /** A creature standing in a square, from the mover's point of view. */
  public record Occupant(CreatureSize size, boolean ally) {}

  /**
   * How far a creature drops moving between two squares, in feet.
   *
   * <p>This is where the board's elevation becomes damage. Zero when the ground
   * rises or holds level — walking up a slope is not a negative fall — and the
   * SRD's ten-feet-per-d6 does the rest.
   */
  public int dropEntering(int fromX, int fromY, int toX, int toY) {
    return Falling.dropBetween(elevationAt(fromX, fromY), elevationAt(toX, toY));
  }

  /**
   * What a creature takes for that drop, or null if the step hurts nobody.
   *
   * @see Falling
   */
  public DiceRoll fallDamageEntering(int fromX, int fromY, int toX, int toY) {
    return Falling.damage(dropEntering(fromX, fromY, toX, toY));
  }

  /** Whether a fall into this square is a fall into liquid, which can be halved. */
  public boolean liquidLanding(int cx, int cy) {
    return Falling.isLiquid(terrainAt(cx, cy));
  }

  // region Sight and cover

  /**
   * Whether anything opaque stands between two points.
   *
   * <p>Walks the cells the segment actually crosses rather than sampling at
   * intervals, so a wall cannot be stepped over by a line that passes through
   * its corner.
   */
  public boolean hasLineOfSight(Point from, Point to) {
    int x0 = cellX(from.x());
    int y0 = cellY(from.y());
    int x1 = cellX(to.x());
    int y1 = cellY(to.y());
    int dx = Math.abs(x1 - x0);
    int dy = Math.abs(y1 - y0);
    int sx = Integer.signum(x1 - x0);
    int sy = Integer.signum(y1 - y0);
    int x = x0;
    int y = y0;
    int err = dx - dy;

    while (x != x1 || y != y1) {
      int e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      // The endpoints themselves never block: a creature standing in a doorway
      // can still be seen, and an attacker inside a wall is a placement bug
      // rather than a sight one.
      if ((x != x1 || y != y1) && opaqueAt(x, y)) {
        return false;
      }
    }
    return true;
  }

  /**
   * The cover a target benefits from against this attacker.
   *
   * <p><b>Ours, not the book's.</b> The SRD names three degrees and their
   * effects but contains no grid rules at all — it speaks in feet and spaces —
   * so how cover is determined is a choice we own. This traces from the
   * attacker's centre to the target's four corners and its centre, and grades on
   * how many arrive: a rule a DM can predict, and one that gives a target behind
   * a pillar's edge less protection than one fully behind it.
   *
   * <p>A square with explicit {@code cover} painted on it raises the floor, so a
   * DM who marks a low wall as Half Cover gets at least that regardless of how
   * the traces land.
   */
  public CoverDegree coverBetween(Footprint attacker, Footprint target) {
    int half = target.halfSpace();
    Point c = target.at();
    List<Point> aims = List.of(
        c,
        new Point(c.x() - half, c.y() - half, c.z()),
        new Point(c.x() + half, c.y() - half, c.z()),
        new Point(c.x() - half, c.y() + half, c.z()),
        new Point(c.x() + half, c.y() + half, c.z()));

    int clear = 0;
    for (Point aim : aims) {
      if (hasLineOfSight(attacker.at(), aim)) {
        clear++;
      }
    }
    CoverDegree traced = switch (clear) {
      case 5, 4 -> CoverDegree.NONE;
      case 3 -> CoverDegree.HALF;
      case 2, 1 -> CoverDegree.THREE_QUARTERS;
      default -> CoverDegree.TOTAL;
    };
    // "If behind more than one degree of cover, a target benefits only from the
    // most protective degree" — so this is a max, not a sum.
    CoverDegree painted = coverAt(cellX(c.x()), cellY(c.y()));
    return traced.ordinal() >= painted.ordinal() ? traced : painted;
  }
  // endregion

  /**
   * Whether {@code mover} may stand at {@code where} without displacing anyone.
   *
   * <p>Overlap is the rule and the exceptions are earned: a swarm, an air
   * elemental and a water elemental all carry
   * {@link Capability#OCCUPY_CREATURE_SPACE}, which is exactly the permission to
   * break it. Asking the creature rather than special-casing by name is why that
   * capability exists as data.
   */
  public boolean canStand(Footprint mover, Set<Capability> moverCapabilities,
      List<Footprint> others, List<Set<Capability>> othersCapabilities) {
    for (int i = 0; i < others.size(); i++) {
      if (!Geometry.overlaps(mover, others.get(i))) {
        continue;
      }
      boolean moverMayShare = moverCapabilities.contains(Capability.OCCUPY_CREATURE_SPACE);
      boolean otherMayShare =
          othersCapabilities.get(i).contains(Capability.OCCUPY_CREATURE_SPACE);
      // Either party's permission is enough — a swarm may occupy a knight's
      // space whether or not the knight has any say in it.
      if (!moverMayShare && !otherMayShare) {
        return false;
      }
    }
    return true;
  }
}
