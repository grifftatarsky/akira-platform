/**
 * Turning pointer events into board gestures.
 *
 * <p>Pure, and separate from the renderer for the same reason the scene is:
 * jsdom has no WebGL context, so anything that lived inside the renderer could
 * not be tested. What is decided here is everything that does not need a GPU —
 * whether a press became a drag, what a drop snaps to, how far a wheel notch
 * zooms — and the renderer is left with the one thing only it can do, which is
 * turn a screen pixel into a point on the ground.
 */

/** How far the pointer must travel before a press stops being a click. */
export const DRAG_THRESHOLD_PX = 4;

/** What a gesture turned out to be. */
export type Gesture =
  | { readonly kind: 'CLICK'; readonly tokenId: string | null }
  | { readonly kind: 'DRAG_TOKEN'; readonly tokenId: string }
  | { readonly kind: 'PAN' }
  | { readonly kind: 'NONE' };

export interface PointerStart {
  readonly x: number;
  readonly y: number;
  /** What was under the pointer when it went down, if anything. */
  readonly tokenId: string | null;
  /** Right or middle button, which always pans whatever is underneath. */
  readonly panButton: boolean;
}

/**
 * What a press has become, given where the pointer is now.
 *
 * <p>Deciding this from distance rather than from time is deliberate: a DM who
 * holds still while thinking has not started a drag, and one who flicks a token
 * across the board in 80 ms has.
 */
export function gestureFor(start: PointerStart, x: number, y: number): Gesture {
  const moved = Math.hypot(x - start.x, y - start.y) >= DRAG_THRESHOLD_PX;
  if (start.panButton) {
    return { kind: 'PAN' };
  }
  if (!moved) {
    return { kind: 'CLICK', tokenId: start.tokenId };
  }
  // Dragging empty ground pans; dragging a creature moves it. Which means the
  // board never needs a mode switch to do the two things a DM does constantly.
  return start.tokenId
    ? { kind: 'DRAG_TOKEN', tokenId: start.tokenId }
    : { kind: 'PAN' };
}

/**
 * Where a dropped token lands, in half-feet.
 *
 * <p><b>Snapped by default, free when asked.</b> Continuous positions are the
 * point of the geometry — a DM should be able to put the rogue half behind the
 * pillar — but the overwhelming case is putting a creature *on a square*, and
 * making that the fiddly one would be a strange trade. So the modifier key buys
 * precision rather than paying for convenience.
 *
 * @param cellHalfFeet the map's cell size, which is what a square means here
 * @param free true while the precision modifier is held
 */
export function dropAt(
  xHalfFeet: number,
  yHalfFeet: number,
  cellHalfFeet: number,
  free: boolean,
): { x: number; y: number } {
  if (free || cellHalfFeet <= 0) {
    return { x: Math.round(xHalfFeet), y: Math.round(yHalfFeet) };
  }
  // The centre of the square it was dropped on, not its corner: a token's
  // position is a centre everywhere else in the stack.
  const snap = (v: number) =>
    Math.floor(v / cellHalfFeet) * cellHalfFeet + cellHalfFeet / 2;
  return { x: snap(xHalfFeet), y: snap(yHalfFeet) };
}

/**
 * Zoom after a wheel notch.
 *
 * <p>Multiplicative, because zooming is scale rather than distance: a fixed
 * step feels glacial when zoomed out and violent when zoomed in.
 */
export function zoomAfterWheel(current: number, deltaY: number): number {
  const factor = Math.exp(deltaY * 0.0015);
  return clampZoom(current * factor);
}

/** Kept between a token filling the screen and the whole board vanishing. */
export function clampZoom(halfFeet: number): number {
  return Math.max(20, Math.min(2000, halfFeet));
}

/**
 * A path from where a creature is to where it was dropped.
 *
 * <p>One leg per square crossed, rather than a single hop, because the engine
 * charges per square and asks per square whether the step provokes: "the attack
 * occurs right before the creature leaves your reach". A one-hop path would
 * cost the right total and open the window in the wrong place — or not at all.
 */
export function pathBetween(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  cellHalfFeet: number,
): { xHalfFeet: number; yHalfFeet: number; zHalfFeet: number }[] {
  if (cellHalfFeet <= 0) {
    return [{ xHalfFeet: toX, yHalfFeet: toY, zHalfFeet: 0 }];
  }
  // Chebyshev, the engine's metric: a diagonal costs what a straight line
  // costs, so the number of steps is the longer of the two axes.
  const dx = toX - fromX;
  const dy = toY - fromY;
  const steps = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / cellHalfFeet));
  const legs = [];
  for (let i = 1; i <= steps; i++) {
    legs.push({
      xHalfFeet: Math.round(fromX + (dx * i) / steps),
      yHalfFeet: Math.round(fromY + (dy * i) / steps),
      zHalfFeet: 0,
    });
  }
  return legs;
}
