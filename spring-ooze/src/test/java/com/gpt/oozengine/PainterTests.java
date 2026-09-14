package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.rules.PaintShape;
import com.gpt.oozengine.model.dto.request.PaintRequest;
import com.gpt.oozengine.service.Painter;
import com.gpt.oozengine.service.Painter.Square;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Which squares a stroke covers. A gap in a wall is a door nobody built. */
class PainterTests {

  private static PaintRequest stroke(PaintShape shape, int x1, int y1, int x2, int y2) {
    return new PaintRequest(shape, x1, y1, x2, y2, false, null);
  }

  @Test
  @DisplayName("A rectangle fills, an outline does not")
  void rectangleVersusOutline() {
    var filled = Painter.cover(stroke(PaintShape.RECTANGLE, 1, 1, 4, 4), 20, 20);
    var outline = Painter.cover(stroke(PaintShape.OUTLINE, 1, 1, 4, 4), 20, 20);

    assertThat(filled).hasSize(16);
    // The ring of a 4x4 is 12 squares; the four interior ones stay clear, which
    // is the difference between a room and a solid block of rock.
    assertThat(outline).hasSize(12);
    assertThat(outline).doesNotContain(new Square(2, 2), new Square(3, 3));
    assertThat(outline).contains(new Square(1, 1), new Square(4, 4), new Square(1, 4));
  }

  @Test
  @DisplayName("A diagonal line leaves no gap to walk through")
  void diagonalLineIsSolid() {
    var line = Painter.cover(stroke(PaintShape.LINE, 0, 0, 3, 3), 20, 20);

    // Plain Bresenham steps diagonally and yields four squares, with a gap at
    // every corner a creature can slip through. A wall has to be solid.
    assertThat(line).hasSizeGreaterThan(4);
    assertThat(line).contains(new Square(0, 0), new Square(3, 3), new Square(1, 0));
  }

  @Test
  @DisplayName("A stroke dragged off the edge is clipped, not refused")
  void clippedToBounds() {
    var line = Painter.cover(stroke(PaintShape.RECTANGLE, -5, -5, 2, 2), 10, 10);

    // Dragging off the edge is how anyone paints the edge; refusing it would
    // make the outer ring the hardest part of the board to work with.
    assertThat(line).allSatisfy(sq -> {
      assertThat(sq.x()).isBetween(0, 9);
      assertThat(sq.y()).isBetween(0, 9);
    });
    assertThat(line).contains(new Square(0, 0), new Square(2, 2));
  }

  @Test
  @DisplayName("Corners in any order describe the same rectangle")
  void cornersAreOrderIndependent() {
    var forward = Painter.cover(stroke(PaintShape.RECTANGLE, 1, 1, 5, 5), 20, 20);
    var backward = Painter.cover(stroke(PaintShape.RECTANGLE, 5, 5, 1, 1), 20, 20);

    assertThat(forward).isEqualTo(backward);
  }

  @Test
  @DisplayName("A single square is a legal stroke of every shape")
  void degenerateStrokes() {
    for (PaintShape shape : Painter.shapes()) {
      assertThat(Painter.cover(stroke(shape, 3, 3, 3, 3), 10, 10))
          .as("%s", shape)
          .containsExactly(new Square(3, 3));
    }
  }

  @Test
  @DisplayName("A stroke entirely off the board covers nothing")
  void offBoardCoversNothing() {
    assertThat(Painter.isEmpty(stroke(PaintShape.RECTANGLE, 50, 50, 60, 60), 10, 10)).isTrue();
  }
}
