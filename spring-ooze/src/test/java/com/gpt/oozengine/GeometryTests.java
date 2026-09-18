package com.gpt.oozengine;

import static com.gpt.oozengine.util.Geometry.feet;
import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.util.Geometry;
import com.gpt.oozengine.util.Geometry.Footprint;
import com.gpt.oozengine.util.Geometry.Point;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** The board's measurements, against the rules they are supposed to reproduce. */
class GeometryTests {

  private static Footprint at(int xFeet, int yFeet, CreatureSize size) {
    return Footprint.of(new Point(feet(xFeet), feet(yFeet)), size);
  }

  private static Footprint at(int xFeet, int yFeet, int zFeet, CreatureSize size) {
    return Footprint.of(new Point(feet(xFeet), feet(yFeet), feet(zFeet)), size);
  }

  @Nested
  @DisplayName("Chebyshev distance")
  class Distance {

    @Test
    @DisplayName("A diagonal costs what a straight line costs")
    void diagonalsAreFree() {
      var origin = new Point(0, 0);
      // Four squares east, and four east plus four north, are both 20 feet —
      // which is the grid rule the game actually plays by.
      assertThat(Geometry.distance(origin, new Point(feet(20), 0))).isEqualTo(feet(20));
      assertThat(Geometry.distance(origin, new Point(feet(20), feet(20)))).isEqualTo(feet(20));
    }

    @Test
    @DisplayName("Thirty feet up and thirty across is thirty, not forty-two")
    void elevationIsTheSameMetric() {
      // How the game treats flying, and the reason elevation is a third
      // Chebyshev axis rather than a Euclidean correction.
      assertThat(Geometry.distance(new Point(0, 0, 0), new Point(feet(30), 0, feet(30))))
          .isEqualTo(feet(30));
    }

    @Test
    @DisplayName("Off-grid placement measures cleanly, with no snapping")
    void continuousPositionsAreFine() {
      // Half a square east of a square boundary — a token nudged behind a
      // pillar. Nothing rounds, and nothing produces a fraction.
      assertThat(Geometry.distance(new Point(5, 0), new Point(feet(10), 0))).isEqualTo(15);
    }
  }

  @Nested
  @DisplayName("Reach, measured edge to edge")
  class Reach {

    @Test
    @DisplayName("Two Medium creatures 5 feet apart are adjacent")
    void mediumAdjacency() {
      // Centres 10 feet apart, each occupying 5 feet, so their edges touch.
      assertThat(Geometry.adjacent(at(0, 0, CreatureSize.MEDIUM), at(10, 0, CreatureSize.MEDIUM)))
          .isTrue();
      assertThat(Geometry.adjacent(at(0, 0, CreatureSize.MEDIUM), at(20, 0, CreatureSize.MEDIUM)))
          .isFalse();
    }

    @Test
    @DisplayName("A Gargantuan creature reaches further from the same centre")
    void sizeExtendsReach() {
      var tarrasque = at(0, 0, CreatureSize.GARGANTUAN);
      var knight = at(25, 0, CreatureSize.MEDIUM);

      // Centres are 25 feet apart. The tarrasque's edge is 10 feet from its
      // centre and the knight's is 2½ from theirs, so the gap is 12½ feet — out
      // of reach for a Medium creature and well inside a 15-foot reach.
      assertThat(Geometry.separation(tarrasque, knight)).isEqualTo(25);
      assertThat(Geometry.withinReach(tarrasque, knight, feet(15))).isTrue();
      assertThat(Geometry.withinReach(knight, tarrasque, feet(5))).isFalse();

      // The point of measuring edge to edge: from the same centres, a
      // point-to-point reading would call this 25 feet and refuse the attack.
      assertThat(Geometry.distance(tarrasque.at(), knight.at())).isEqualTo(feet(25));
    }

    @Test
    @DisplayName("Separation is symmetric, whichever creature asks")
    void separationIsSymmetric() {
      var a = at(0, 0, CreatureSize.HUGE);
      var b = at(30, 15, CreatureSize.TINY);

      assertThat(Geometry.separation(a, b)).isEqualTo(Geometry.separation(b, a));
    }

    @Test
    @DisplayName("Overlapping creatures have no gap between them")
    void overlapIsZeroSeparation() {
      assertThat(Geometry.separation(at(0, 0, CreatureSize.LARGE), at(0, 0, CreatureSize.MEDIUM)))
          .isZero();
    }
  }

  @Nested
  @DisplayName("Footprints, so tokens do not overlap")
  class Overlap {

    @Test
    @DisplayName("Two Medium creatures cannot share a square, but can touch")
    void mediumCrowding() {
      assertThat(Geometry.overlaps(at(0, 0, CreatureSize.MEDIUM), at(0, 0, CreatureSize.MEDIUM)))
          .isTrue();
      assertThat(Geometry.overlaps(at(0, 0, CreatureSize.MEDIUM), at(5, 0, CreatureSize.MEDIUM)))
          .isFalse();
    }

    @Test
    @DisplayName("Four Tiny creatures fit where one Small one does")
    void tinyCrowding() {
      // The book's 2½-foot square, exact because the unit is the half-foot.
      // Two Tiny creatures 2½ feet apart do not overlap; at 2 feet they do.
      var a = Footprint.of(new Point(0, 0), CreatureSize.TINY);
      assertThat(Geometry.overlaps(a, Footprint.of(new Point(5, 0), CreatureSize.TINY))).isFalse();
      assertThat(Geometry.overlaps(a, Footprint.of(new Point(4, 0), CreatureSize.TINY))).isTrue();
    }

    @Test
    @DisplayName("A big creature needs proportionally more room")
    void sizeDrivesClearance() {
      var huge = at(0, 0, CreatureSize.HUGE);

      // Huge is 15 feet and Medium 5, so their centres must be at least 10 feet
      // apart — half of 15 plus half of 5.
      assertThat(Geometry.minimumCentreDistance(huge, at(0, 0, CreatureSize.MEDIUM)))
          .isEqualTo(feet(10));
      assertThat(Geometry.overlaps(huge, at(10, 0, CreatureSize.MEDIUM))).isFalse();
      assertThat(Geometry.overlaps(huge, at(9, 0, CreatureSize.MEDIUM))).isTrue();
    }

    @Test
    @DisplayName("Minimum clearance never needs rounding, even between two Tiny creatures")
    void clearanceStaysIntegral() {
      // 2½ + 2½ halves to 2½ feet, which is 5 half-feet — an integer only
      // because the unit is the half-foot. In feet this is the case that would
      // force a rounding decision on every placement.
      var tiny = Footprint.of(new Point(0, 0), CreatureSize.TINY);
      assertThat(Geometry.minimumCentreDistance(tiny, tiny)).isEqualTo(5);
    }

    @Test
    @DisplayName("Overlap ignores elevation only when creatures share it")
    void flyingClearsTheGround() {
      var ground = at(0, 0, 0, CreatureSize.MEDIUM);
      // A creature 10 feet up is not standing on anyone.
      assertThat(Geometry.overlaps(ground, at(0, 0, 10, CreatureSize.MEDIUM))).isFalse();
      assertThat(Geometry.overlaps(ground, at(0, 0, 0, CreatureSize.MEDIUM))).isTrue();
    }
  }

  @Test
  @DisplayName("Every size in the book round-trips through the half-foot unit")
  void sizesAreExact() {
    assertThat(CreatureSize.TINY.spaceFeet()).isEqualTo(2.5);
    for (CreatureSize s : CreatureSize.values()) {
      assertThat(Geometry.toFeet(s.spaceHalfFeet())).isEqualTo(s.spaceFeet());
    }
  }
}
