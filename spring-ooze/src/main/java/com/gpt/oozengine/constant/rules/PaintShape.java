package com.gpt.oozengine.constant.rules;

/**
 * How a paint operation covers ground.
 *
 * <p>Painting a cave wall by wall is a few hundred requests, so the board is
 * painted in strokes. Each shape is defined by two corners, which is enough for
 * all three and keeps the request one shape rather than three.
 */
public enum PaintShape {
  /** Every square in the rectangle the two corners describe. */
  RECTANGLE,

  /** The rectangle's edge only — a room's walls without filling the room. */
  OUTLINE,

  /** The squares a straight line between the two corners crosses. */
  LINE
}
