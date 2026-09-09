package com.gpt.oozengine;

import static com.gpt.oozengine.util.Geometry.feet;
import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.rules.Capability;
import com.gpt.oozengine.constant.rules.CoverDegree;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.LightLevel;
import com.gpt.oozengine.constant.rules.TerrainKind;
import com.gpt.oozengine.model.encounter.BattleMap;
import com.gpt.oozengine.model.encounter.MapCell;
import com.gpt.oozengine.service.Battlefield;
import com.gpt.oozengine.service.Battlefield.Occupant;
import com.gpt.oozengine.util.Geometry.Footprint;
import com.gpt.oozengine.util.Geometry.Point;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** The board answering questions about itself, against the rules it implements. */
class BattlefieldTests {

  private final BattleMap map = new BattleMap();
  private final List<MapCell> painted = new ArrayList<>();

  /** A wall at cell (cx, cy). */
  private void wall(int cx, int cy) {
    MapCell c = new MapCell();
    c.setX(cx);
    c.setY(cy);
    c.setTerrain(TerrainKind.WALL);
    painted.add(c);
  }

  private MapCell cell(int cx, int cy) {
    MapCell c = new MapCell();
    c.setX(cx);
    c.setY(cy);
    painted.add(c);
    return c;
  }

  private Battlefield field() {
    return new Battlefield(map, painted);
  }

  /** A creature standing in the middle of cell (cx, cy). */
  private static Footprint in(int cx, int cy, CreatureSize size) {
    return Footprint.of(new Point(feet(cx * 5) + 5, feet(cy * 5) + 5), size);
  }

  @Nested
  @DisplayName("Sampling")
  class Sampling {

    @Test
    @DisplayName("An unpainted square is the map's default, not a missing row")
    void defaultsFillTheBoard() {
      var f = field();
      // Sparse storage means most of the board has no row at all; asking about
      // it must answer the default rather than null.
      assertThat(f.terrainAt(7, 7)).isEqualTo(TerrainKind.FLOOR);
      assertThat(f.lightAt(7, 7)).isEqualTo(LightLevel.BRIGHT);
      assertThat(f.elevationAt(7, 7)).isZero();
      assertThat(f.opaqueAt(7, 7)).isFalse();
    }

    @Test
    @DisplayName("A painted square overrides only what it sets")
    void paintedOverridesArePartial() {
      cell(3, 3).setElevationFeet(10);
      var f = field();

      assertThat(f.elevationAt(3, 3)).isEqualTo(10);
      // Terrain and light were never set on that cell, so they stay default.
      assertThat(f.terrainAt(3, 3)).isEqualTo(TerrainKind.FLOOR);
      assertThat(f.lightAt(3, 3)).isEqualTo(LightLevel.BRIGHT);
    }

    @Test
    @DisplayName("Off the board reads as opaque, so sight stops at the edge")
    void outOfBoundsBlocks() {
      assertThat(field().opaqueAt(-1, 0)).isTrue();
      assertThat(field().opaqueAt(0, map.getHeight())).isTrue();
    }
  }

  @Nested
  @DisplayName("Line of sight")
  class Sight {

    @Test
    @DisplayName("Clear ground is clear")
    void openGround() {
      assertThat(field().hasLineOfSight(new Point(0, 0), new Point(feet(40), feet(40)))).isTrue();
    }

    @Test
    @DisplayName("A wall between two creatures blocks it")
    void wallBlocks() {
      wall(2, 0);
      assertThat(field().hasLineOfSight(new Point(5, 5), new Point(feet(20), 5))).isFalse();
    }

    @Test
    @DisplayName("Standing in a doorway does not blind you")
    void endpointsNeverBlock() {
      // The target's own square being opaque is a placement question, not a
      // sight one — otherwise a creature in a doorway could never be seen.
      wall(4, 0);
      assertThat(field().hasLineOfSight(new Point(5, 5), in(4, 0, CreatureSize.MEDIUM).at()))
          .isTrue();
    }

    @Test
    @DisplayName("Sight is symmetric")
    void symmetric() {
      wall(3, 3);
      var f = field();
      var a = new Point(5, 5);
      var b = new Point(feet(30), feet(30));

      assertThat(f.hasLineOfSight(a, b)).isEqualTo(f.hasLineOfSight(b, a));
    }
  }

  @Nested
  @DisplayName("Cover")
  class Cover {

    @Test
    @DisplayName("Nothing in the way is no cover")
    void openGroundGivesNothing() {
      assertThat(field().coverBetween(in(0, 0, CreatureSize.MEDIUM), in(6, 0, CreatureSize.MEDIUM)))
          .isEqualTo(CoverDegree.NONE);
    }

    @Test
    @DisplayName("A wall dead ahead is Total Cover, and cannot be targeted")
    void fullyBlockedIsTotal() {
      for (int y = -1; y <= 1; y++) {
        wall(3, Math.max(0, y));
      }
      var cover = field().coverBetween(in(0, 0, CreatureSize.MEDIUM), in(6, 0, CreatureSize.MEDIUM));

      assertThat(cover).isEqualTo(CoverDegree.TOTAL);
      assertThat(cover.blocksTargeting()).isTrue();
    }

    @Test
    @DisplayName("Painted cover raises the floor, however the traces land")
    void paintedCoverWins() {
      // A DM marking a low wall as Half Cover means it, even on open sightlines
      // where every trace arrives.
      cell(6, 0).setCover(CoverDegree.HALF);
      var cover = field().coverBetween(in(0, 0, CreatureSize.MEDIUM), in(6, 0, CreatureSize.MEDIUM));

      assertThat(cover).isEqualTo(CoverDegree.HALF);
      // From the glossary: Half Cover is "+2 bonus to AC and Dexterity saving
      // throws".
      assertThat(cover.armorClassBonus()).isEqualTo(2);
    }

    @Test
    @DisplayName("The most protective degree wins, never the sum")
    void coverDoesNotStack() {
      // "If behind more than one degree of cover, a target benefits only from
      // the most protective degree."
      cell(6, 0).setCover(CoverDegree.HALF);
      wall(3, 0);
      var cover = field().coverBetween(in(0, 0, CreatureSize.MEDIUM), in(6, 0, CreatureSize.MEDIUM));

      assertThat(cover.armorClassBonus()).isNotEqualTo(2 + 5);
      assertThat(cover).isIn(CoverDegree.THREE_QUARTERS, CoverDegree.TOTAL);
    }
  }

  @Nested
  @DisplayName("Movement cost")
  class Movement {

    @Test
    @DisplayName("Open floor costs the cell, rubble costs double")
    void difficultTerrainDoubles() {
      cell(2, 2).setTerrain(TerrainKind.RUBBLE);
      var f = field();

      assertThat(f.enterCost(1, 1, CreatureSize.MEDIUM, List.of())).isEqualTo(5);
      assertThat(f.enterCost(2, 2, CreatureSize.MEDIUM, List.of())).isEqualTo(10);
    }

    @Test
    @DisplayName("An enemy in the square makes it difficult; an ally does not")
    void occupancyIsDynamic() {
      var f = field();
      var enemy = List.of(new Occupant(CreatureSize.MEDIUM, false));
      var ally = List.of(new Occupant(CreatureSize.MEDIUM, true));

      // "A creature that isn't Tiny or your ally" — so the same square costs
      // different amounts to two different movers, which is why this can never
      // be cached on the cell.
      assertThat(f.enterCost(1, 1, CreatureSize.MEDIUM, enemy)).isEqualTo(10);
      assertThat(f.enterCost(1, 1, CreatureSize.MEDIUM, ally)).isEqualTo(5);
    }

    @Test
    @DisplayName("A Tiny creature never makes a square difficult")
    void tinyIsExempt() {
      var f = field();
      var rat = List.of(new Occupant(CreatureSize.TINY, false));

      assertThat(f.enterCost(1, 1, CreatureSize.MEDIUM, rat)).isEqualTo(5);
    }

    @Test
    @DisplayName("Difficult terrain is not cumulative with a crowd")
    void notCumulative() {
      cell(2, 2).setTerrain(TerrainKind.RUBBLE);
      var crowd = List.of(new Occupant(CreatureSize.LARGE, false),
          new Occupant(CreatureSize.HUGE, false));

      // "Difficult Terrain isn't cumulative; either a space is Difficult Terrain
      // or it isn't."
      assertThat(field().enterCost(2, 2, CreatureSize.MEDIUM, crowd)).isEqualTo(10);
    }
  }

  @Nested
  @DisplayName("Standing somewhere")
  class Placement {

    private static final Set<Capability> NONE = Set.of();
    private static final Set<Capability> SWARM =
        EnumSet.of(Capability.OCCUPY_CREATURE_SPACE);

    @Test
    @DisplayName("Two creatures cannot be placed in the same space")
    void overlapIsRejected() {
      var knight = in(4, 4, CreatureSize.MEDIUM);

      assertThat(field().canStand(in(4, 4, CreatureSize.MEDIUM), NONE,
          List.of(knight), List.of(NONE))).isFalse();
    }

    @Test
    @DisplayName("A swarm may share a space, because the book says it may")
    void capabilityEarnsTheException() {
      // Swarm: "can occupy another creature's space and vice versa". The
      // permission is data on the creature, so the rule is asked rather than
      // special-cased by name.
      var knight = in(4, 4, CreatureSize.MEDIUM);

      assertThat(field().canStand(in(4, 4, CreatureSize.MEDIUM), SWARM,
          List.of(knight), List.of(NONE))).isTrue();
    }

    @Test
    @DisplayName("\"and vice versa\" — either side's permission is enough")
    void permissionIsMutual() {
      var swarm = in(4, 4, CreatureSize.MEDIUM);

      assertThat(field().canStand(in(4, 4, CreatureSize.MEDIUM), NONE,
          List.of(swarm), List.of(SWARM))).isTrue();
    }

    @Test
    @DisplayName("Clear ground is always fine")
    void emptySpaceIsFine() {
      assertThat(field().canStand(in(1, 1, CreatureSize.GARGANTUAN), NONE,
          List.of(in(9, 9, CreatureSize.MEDIUM)), List.of(NONE))).isTrue();
    }
  }

  @Nested
  @DisplayName("Elevation, where the board becomes damage")
  class Elevation {

    @Test
    @DisplayName("Stepping off a ledge is a fall of the height difference")
    void steppingOff() {
      cell(2, 2).setElevationFeet(30);
      var f = field();

      assertThat(f.dropEntering(2, 2, 3, 2)).isEqualTo(30);
      assertThat(f.fallDamageEntering(2, 2, 3, 2).getCount()).isEqualTo(3);
      assertThat(f.fallDamageEntering(2, 2, 3, 2).getFaces()).isEqualTo(6);
    }

    @Test
    @DisplayName("Climbing onto the ledge is not a fall")
    void climbingUp() {
      cell(2, 2).setElevationFeet(30);
      var f = field();

      assertThat(f.dropEntering(3, 2, 2, 2)).isZero();
      assertThat(f.fallDamageEntering(3, 2, 2, 2)).isNull();
    }

    @Test
    @DisplayName("A short step down costs nothing")
    void shortDrop() {
      cell(2, 2).setElevationFeet(5);
      // "for every 10 feet it fell" — five feet is no dice at all.
      assertThat(field().fallDamageEntering(2, 2, 3, 2)).isNull();
    }

    @Test
    @DisplayName("Falling into water is the case that can be halved")
    void intoWater() {
      cell(2, 2).setElevationFeet(40);
      cell(3, 2).setTerrain(TerrainKind.WATER);
      var f = field();

      assertThat(f.fallDamageEntering(2, 2, 3, 2).getCount()).isEqualTo(4);
      assertThat(f.liquidLanding(3, 2)).isTrue();
      assertThat(f.liquidLanding(4, 2)).isFalse();
    }
  }
}
