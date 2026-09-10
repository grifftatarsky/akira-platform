import {
  DRAG_THRESHOLD_PX, PointerStart, clampZoom, dropAt, gestureFor, pathBetween, zoomAfterWheel,
} from './board-gestures';

/**
 * What a pointer meant.
 *
 * <p>Testable because it is separate from the renderer — the same split the
 * scene builder uses, and for the same reason: jsdom has no WebGL context, so
 * anything decided inside the renderer could not be asserted at all.
 */
describe('board gestures', () => {

  function press(over: Partial<PointerStart> = {}): PointerStart {
    return { x: 100, y: 100, tokenId: null, panButton: false, ...over };
  }

  describe('what a press became', () => {

    it('a press that has not travelled is a click, not a drag', () => {
      // A DM who holds still while thinking has not started dragging.
      const g = gestureFor(press({ tokenId: 'owlbear' }), 101, 101);

      expect(g).toEqual({ kind: 'CLICK', tokenId: 'owlbear' });
    });

    it('a press on empty ground is a click on nothing, which deselects', () => {
      expect(gestureFor(press(), 100, 100)).toEqual({ kind: 'CLICK', tokenId: null });
    });

    it('dragging a creature moves it; dragging the board pans', () => {
      const far = 100 + DRAG_THRESHOLD_PX + 1;

      // The two things a DM does constantly, without a mode switch between them.
      expect(gestureFor(press({ tokenId: 'owlbear' }), far, 100))
        .toEqual({ kind: 'DRAG_TOKEN', tokenId: 'owlbear' });
      expect(gestureFor(press(), far, 100)).toEqual({ kind: 'PAN' });
    });

    it('the right button always pans, whatever is underneath', () => {
      const g = gestureFor(press({ tokenId: 'owlbear', panButton: true }), 400, 400);

      expect(g).toEqual({ kind: 'PAN' });
    });

    it('the threshold is distance, not axis', () => {
      // A diagonal flick of 3px each way is 4.24px of travel, which is a drag.
      const g = gestureFor(press({ tokenId: 'x' }), 103, 103);

      expect(g.kind).toBe('DRAG_TOKEN');
    });
  });

  describe('where a token lands', () => {

    it('snaps to the centre of the square by default', () => {
      // A centre, not a corner: a token's position is a centre everywhere else
      // in the stack, and mixing the two is half-cell drift nobody sees.
      expect(dropAt(23, 7, 10, false)).toEqual({ x: 25, y: 5 });
    });

    it('places freely when the precision modifier is held', () => {
      // Continuous positions are the point of the geometry — the rogue goes
      // half behind the pillar — so the modifier buys precision rather than
      // convenience costing it.
      expect(dropAt(23, 7, 10, true)).toEqual({ x: 23, y: 7 });
    });

    it('never produces a fraction', () => {
      const free = dropAt(23.6, 7.4, 10, true);
      const snapped = dropAt(23.6, 7.4, 10, false);

      // Half-feet are integers throughout the engine; a renderer handing back
      // 23.6 would be the one place a rounding decision lived.
      expect(Number.isInteger(free.x)).toBe(true);
      expect(Number.isInteger(snapped.x)).toBe(true);
    });

    it('falls back to free placement on a map with no cells', () => {
      expect(dropAt(23, 7, 0, false)).toEqual({ x: 23, y: 7 });
    });
  });

  describe('the path a drag produces', () => {

    it('is one leg per square, not one hop', () => {
      // The engine charges per square and asks per square whether the step
      // provokes. One hop would cost the right total and open the Opportunity
      // Attack window in the wrong place — or not at all.
      const path = pathBetween(5, 5, 45, 5, 10);

      expect(path).toHaveLength(4);
      expect(path.at(-1)).toEqual({ xHalfFeet: 45, yHalfFeet: 5, zHalfFeet: 0 });
    });

    it('counts a diagonal as the longer axis, which is the engine metric', () => {
      // Chebyshev: a diagonal costs what a straight line costs, so four squares
      // across and four up is four steps rather than eight.
      const path = pathBetween(5, 5, 45, 45, 10);

      expect(path).toHaveLength(4);
    });

    it('always ends where it was dropped', () => {
      const path = pathBetween(5, 5, 37, 22, 10);

      expect(path.at(-1)).toEqual({ xHalfFeet: 37, yHalfFeet: 22, zHalfFeet: 0 });
    });

    it('produces one leg for a move within a square', () => {
      expect(pathBetween(5, 5, 7, 5, 10)).toHaveLength(1);
    });

    it('produces only integers, so the engine never sees a fraction', () => {
      const path = pathBetween(5, 5, 38, 17, 10);

      expect(path.every(p => Number.isInteger(p.xHalfFeet) && Number.isInteger(p.yHalfFeet)))
        .toBe(true);
    });
  });

  describe('zoom', () => {

    it('scales rather than steps, so it feels the same at any distance', () => {
      const near = zoomAfterWheel(50, 100);
      const far = zoomAfterWheel(500, 100);

      // A fixed step is glacial when zoomed out and violent when zoomed in.
      expect(far / 500).toBeCloseTo(near / 50, 5);
    });

    it('zooms in on a negative delta and out on a positive one', () => {
      expect(zoomAfterWheel(200, -100)).toBeLessThan(200);
      expect(zoomAfterWheel(200, 100)).toBeGreaterThan(200);
    });

    it('cannot lose the board or fill the screen with one token', () => {
      expect(clampZoom(1)).toBe(20);
      expect(clampZoom(100000)).toBe(2000);
      expect(zoomAfterWheel(20, -10000)).toBe(20);
    });
  });
});
