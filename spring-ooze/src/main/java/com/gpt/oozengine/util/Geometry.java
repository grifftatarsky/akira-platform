package com.gpt.oozengine.util;

import com.gpt.oozengine.constant.rules.CreatureSize;

/**
 * The board's measurements. Continuous positions, Chebyshev distance, integers
 * throughout.
 *
 * <p><b>Positions are continuous, not grid cells.</b> A token sits wherever it
 * sits, so a DM can put the rogue half behind the pillar. Terrain is still a
 * raster because terrain is painted, but placement does not share its
 * resolution.
 *
 * <p><b>Distance is Chebyshev</b> — {@code max(|dx|, |dy|, |dz|)}. Usually
 * described as a grid metric, it is perfectly well defined on continuous space
 * and it is the rule the game plays by: a diagonal costs what a straight line
 * costs. Three things follow for free. Thirty feet up and thirty across is
 * thirty, which is how the game treats flying, with no special case. Tokens that
 * happen to sit on 5-foot centres reproduce square-counting exactly, so a DM who
 * thinks in squares is never surprised. And nothing ever produces a fraction, so
 * it never fights the rest of the book.
 *
 * <p><b>Creatures occupy squares, not points.</b> Reach, cover and adjacency all
 * measure edge to edge. A Gargantuan creature's 20-foot square means its edge is
 * 10 feet from its centre in every direction, and an attack that reaches its
 * flank has 10 fewer feet to travel than one aimed at a point.
 *
 * <p>Everything here is in half-feet, per {@link CreatureSize} — the unit that
 * makes a Tiny creature's 2½-foot square an integer.
 */
public final class Geometry {

  private Geometry() {}

  /**
   * A position on the board, in half-feet. {@code z} is elevation.
   *
   * <p>A record rather than three loose ints because every geometry call takes
   * two of them and transposing an argument is otherwise silent.
   */
  public record Point(int x, int y, int z) {
    public Point(int x, int y) {
      this(x, y, 0);
    }
  }

  /** A creature on the board: where it is, and how much room it takes. */
  public record Footprint(Point at, int spaceHalfFeet) {
    public static Footprint of(Point at, CreatureSize size) {
      return new Footprint(at, size.spaceHalfFeet());
    }

    /** Half the side of the occupied square — centre to edge. */
    public int halfSpace() {
      return spaceHalfFeet / 2;
    }
  }

  /** Chebyshev distance between two points, in half-feet. */
  public static int distance(Point a, Point b) {
    return Math.max(Math.abs(a.x() - b.x()),
        Math.max(Math.abs(a.y() - b.y()), Math.abs(a.z() - b.z())));
  }

  /**
   * The gap between two creatures' nearest edges, in half-feet; 0 when they
   * touch or overlap.
   *
   * <p>This, not centre-to-centre, is what every reach question actually asks. A
   * Huge creature with 5 feet of reach threatens a much larger area than a
   * Medium one with the same reach, and centre distance cannot express that.
   */
  public static int separation(Footprint a, Footprint b) {
    return Math.max(0, distance(a.at(), b.at()) - a.halfSpace() - b.halfSpace());
  }

  /**
   * Whether {@code a} can reach {@code b} with the given reach, in half-feet.
   *
   * <p>The SRD's default: "A creature has a reach of 5 feet unless a rule says
   * otherwise" — which is 10 half-feet.
   */
  public static boolean withinReach(Footprint a, Footprint b, int reachHalfFeet) {
    return separation(a, b) <= reachHalfFeet;
  }

  /** Adjacent: touching, at the book's default 5 feet of reach. */
  public static boolean adjacent(Footprint a, Footprint b) {
    return withinReach(a, b, 10);
  }

  /**
   * Whether two creatures' squares overlap.
   *
   * <p>They overlap when their centres are closer than the sum of their
   * half-spaces. Written as a doubled comparison so an odd total — two Tiny
   * creatures, whose half-spaces are 2½ half-feet each — never needs a fraction
   * or a rounding decision.
   */
  public static boolean overlaps(Footprint a, Footprint b) {
    return 2 * distance(a.at(), b.at()) < a.spaceHalfFeet() + b.spaceHalfFeet();
  }

  /**
   * The nearest legal centre for {@code moving} that does not overlap
   * {@code blocker}, along the line between them.
   *
   * <p>Used to answer "how close can I actually get", which is the question a DM
   * asks when dragging a token, rather than refusing the move outright.
   */
  public static int minimumCentreDistance(Footprint a, Footprint b) {
    // The smallest integer d with 2d >= spaceA + spaceB.
    return (a.spaceHalfFeet() + b.spaceHalfFeet() + 1) / 2;
  }

  /** Feet to the engine's half-feet. */
  public static int feet(int feet) {
    return feet * 2;
  }

  /** Half-feet back to feet, for display; may be fractional only for Tiny. */
  public static double toFeet(int halfFeet) {
    return halfFeet / 2.0;
  }
}
