package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.PaintShape;
import com.gpt.oozengine.model.dto.request.PaintRequest;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Which squares a stroke covers.
 *
 * <p>Pure geometry over cell indices, kept apart from the entity work so the
 * shapes can be tested as shapes: an outline that misses a corner or a line that
 * skips a square is a hole in a cave wall, and a hole in a cave wall is only
 * visible on a board.
 */
public final class Painter {

  private Painter() {}

  /** A square the stroke touches. */
  public record Square(int x, int y) {}

  /**
   * The squares covered, clipped to the map's bounds.
   *
   * <p>Clipped rather than rejected: dragging a rectangle off the edge of the
   * board is how anyone paints the edge of the board, and refusing it would make
   * the outer ring the hardest part of the map to work with.
   */
  public static Set<Square> cover(PaintRequest req, int width, int height) {
    int minX = Math.max(0, Math.min(req.x1(), req.x2()));
    int maxX = Math.min(width - 1, Math.max(req.x1(), req.x2()));
    int minY = Math.max(0, Math.min(req.y1(), req.y2()));
    int maxY = Math.min(height - 1, Math.max(req.y1(), req.y2()));

    Set<Square> out = new LinkedHashSet<>();
    if (minX > maxX || minY > maxY) {
      return out;
    }
    switch (req.shape()) {
      case RECTANGLE -> {
        for (int y = minY; y <= maxY; y++) {
          for (int x = minX; x <= maxX; x++) {
            out.add(new Square(x, y));
          }
        }
      }
      case OUTLINE -> {
        for (int x = minX; x <= maxX; x++) {
          out.add(new Square(x, minY));
          out.add(new Square(x, maxY));
        }
        for (int y = minY; y <= maxY; y++) {
          out.add(new Square(minX, y));
          out.add(new Square(maxX, y));
        }
      }
      case LINE -> line(req, width, height, out);
      default -> throw new IllegalStateException("Unhandled shape " + req.shape());
    }
    return out;
  }

  /**
   * Every square a straight line crosses, not merely the ones nearest it.
   *
   * <p>A supercover walk rather than plain Bresenham: Bresenham steps
   * diagonally, which leaves a one-square gap a creature can walk through. For a
   * decorative line that is invisible; for a wall it is a door nobody built.
   */
  private static void line(PaintRequest req, int width, int height, Set<Square> out) {
    int x = req.x1();
    int y = req.y1();
    int x1 = req.x2();
    int y1 = req.y2();
    int dx = Math.abs(x1 - x);
    int dy = Math.abs(y1 - y);
    int sx = Integer.signum(x1 - x);
    int sy = Integer.signum(y1 - y);
    int err = dx - dy;

    while (true) {
      if (x >= 0 && y >= 0 && x < width && y < height) {
        out.add(new Square(x, y));
      }
      if (x == x1 && y == y1) {
        return;
      }
      int e2 = 2 * err;
      boolean stepX = e2 > -dy;
      boolean stepY = e2 < dx;
      if (stepX) {
        err -= dy;
        x += sx;
      }
      if (stepY) {
        err += dx;
        // Both firing is a diagonal step, and the square it skipped past is the
        // gap. Adding it before the y move is what makes the wall solid; a
        // creature cannot slip between two squares that share an edge.
        if (stepX && x >= 0 && y >= 0 && x < width && y < height) {
          out.add(new Square(x, y));
        }
        y += sy;
      }
    }
  }

  /** Whether a shape needs a brush at all. An erase does not. */
  public static boolean needsBrush(PaintRequest req) {
    return !req.erasing();
  }

  /** A stroke that covers nothing, which is a client bug worth naming. */
  public static boolean isEmpty(PaintRequest req, int width, int height) {
    return cover(req, width, height).isEmpty();
  }

  /** All shapes, so a caller can assert it handles each. */
  public static PaintShape[] shapes() {
    return PaintShape.values();
  }
}
