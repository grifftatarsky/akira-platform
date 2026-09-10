import { LIGHT_RANGE, TEXELS_PER_HALF_FOOT, falloff, lightAt, lightField } from './light-field';
import { BoardScene, LightLevel, PropKind, PropPlacement, TerrainTile } from './board.models';

/**
 * The light on the board.
 *
 * <p>Asserted here rather than by looking at a screenshot, because "is the crypt
 * darker than the hall" is a claim about numbers and the eye is a bad instrument
 * for it — a scene can look moody and still be lighting a sealed room through a
 * wall. Pure for exactly this reason: jsdom has no WebGL context.
 */
describe('light field', () => {

  function tile(over: Partial<TerrainTile> = {}): TerrainTile {
    return {
      x: 5, y: 5, size: 10, base: 0, height: 0, kind: 'FLOOR', light: 'BRIGHT',
      opaque: false, cover: 'NONE', rotation: 0, colour: 0, baseColour: 0, ...over,
    };
  }

  function prop(piece: PropKind, x: number, y: number): PropPlacement {
    return { piece, x, y, z: 0, rotation: 0 };
  }

  /** A one-row board `cells` squares wide, every square at the same level. */
  function board(cells: number, light: LightLevel, props: PropPlacement[] = []): BoardScene {
    const tiles: TerrainTile[] = [];
    for (let i = 0; i < cells; i++) {
      tiles.push(tile({ x: i * 10 + 5, y: 5, light }));
    }
    return {
      tiles, tokens: [], props,
      widthHalfFeet: cells * 10, heightHalfFeet: 10,
    };
  }

  const brightness = ([r, g, b]: readonly number[]) => (r + g + b) / 3;

  describe('levels', () => {

    it('covers the board at the stated resolution', () => {
      const field = lightField(board(20, 'BRIGHT'));

      // 20 squares of 5 feet is 200 half-feet, and four texels to a square.
      expect(field.extentXHalfFeet).toBe(200);
      expect(field.width).toBe(200 * TEXELS_PER_HALF_FOOT);
    });

    it('makes a bright room brighter than a dim one, and dim brighter than dark', () => {
      const lit = lightAt(lightField(board(6, 'BRIGHT')), 25, 5);
      const dim = lightAt(lightField(board(6, 'DIM')), 25, 5);
      const dark = lightAt(lightField(board(6, 'DARKNESS')), 25, 5);

      expect(brightness(lit)).toBeGreaterThan(brightness(dim));
      expect(brightness(dim)).toBeGreaterThan(brightness(dark));
    });

    it('leaves an unlit room legible rather than black', () => {
      // A DM still has to read the board. Darkness is a rule about what a
      // creature can see, not an instruction to stop drawing the room.
      const dark = lightAt(lightField(board(6, 'DARKNESS')), 25, 5);

      expect(brightness(dark)).toBeGreaterThan(0.05);
    });

    it('shifts unlit rooms cold and lit rooms warm', () => {
      // Temperature, not only level. Two rooms that differ only in how grey
      // they are read as one room with the brightness turned down; a cold room
      // and a warm one read as two places.
      const [dr, , db] = lightAt(lightField(board(6, 'DARKNESS')), 25, 5);
      const [lr, , lb] = lightAt(lightField(board(6, 'BRIGHT')), 25, 5);

      expect(db).toBeGreaterThan(dr);
      expect(lr).toBeGreaterThan(lb);
    });

    it('darkens at the square that is dark, not half a room early', () => {
      const mixed = board(6, 'BRIGHT');
      const tiles = mixed.tiles.map((t, i) => i >= 3 ? { ...t, light: 'DARKNESS' as const } : t);
      const field = lightField({ ...mixed, tiles });

      // Square 1 is two squares clear of the boundary and square 4 is one past
      // it; the blur that softens the seam must not reach either.
      expect(brightness(lightAt(field, 15, 5))).toBeGreaterThan(0.8);
      expect(brightness(lightAt(field, 45, 5))).toBeLessThan(0.4);
    });
  });

  describe('flames', () => {

    it('adds a warm pool to the square a torch is on', () => {
      const unlit = lightField(board(10, 'DARKNESS'));
      const torch = lightField(board(10, 'DARKNESS', [prop('TORCH', 45, 5)]));

      const before = lightAt(unlit, 45, 5);
      const after = lightAt(torch, 45, 5);

      expect(brightness(after)).toBeGreaterThan(brightness(before));
      // Warm: a flame is orange, and the whole point of adding rather than
      // brightening is that the pool differs in colour from the room.
      expect(after[0]).toBeGreaterThan(after[2]);
    });

    it('reaches its bright radius and dies by its dim one', () => {
      const field = lightField(board(20, 'DARKNESS', [prop('TORCH', 45, 5)]));
      const dark = brightness(lightAt(lightField(board(20, 'DARKNESS')), 45, 5));

      // A torch is Bright for 20 feet and Dim for 20 more: 40 and 80 half-feet.
      const near = brightness(lightAt(field, 75, 5));
      const far = brightness(lightAt(field, 165, 5));

      expect(near).toBeGreaterThan(dark);
      expect(far).toBeCloseTo(dark, 1);
    });

    it('is added to a lit room rather than replacing its light', () => {
      // A torch in a bright hall still has to read as a torch, or a lit room is
      // one flat wash and nothing in it is a light source.
      const plain = brightness(lightAt(lightField(board(10, 'BRIGHT')), 45, 5));
      const torch = brightness(
        lightAt(lightField(board(10, 'BRIGHT', [prop('TORCH', 45, 5)])), 45, 5));

      expect(torch).toBeGreaterThan(plain);
    });

    it('lets a flame exceed full brightness, so a tone curve has something to roll off', () => {
      const field = lightField(board(10, 'BRIGHT', [prop('TORCH', 45, 5)]));

      expect(Math.max(...lightAt(field, 45, 5))).toBeGreaterThan(1);
      // And never past what one byte can carry at this scale.
      expect(Math.max(...lightAt(field, 45, 5))).toBeLessThanOrEqual(LIGHT_RANGE);
    });

    it('ignores a prop that is not on fire', () => {
      const plain = lightAt(lightField(board(10, 'DARKNESS')), 45, 5);
      const barrel = lightAt(lightField(board(10, 'DARKNESS', [prop('BARREL', 45, 5)])), 45, 5);

      expect(barrel).toEqual(plain);
    });
  });

  describe('falloff', () => {

    it('is full at the flame and gone at the outer edge', () => {
      expect(falloff(0, 40, 80)).toBe(1);
      expect(falloff(80, 40, 80)).toBe(0);
      expect(falloff(200, 40, 80)).toBe(0);
    });

    it('falls away inside the bright radius rather than holding full strength', () => {
      // The SRD's radii are a rules abstraction, not an intensity curve. Held
      // flat across the whole bright radius, a dozen torches overlap into an
      // even wash and nothing on the board reads as a light source — which is
      // the opposite of the point of placing them.
      expect(falloff(40, 40, 80)).toBeLessThan(0.5);
      expect(falloff(40, 40, 80)).toBeGreaterThan(0);
    });

    it('drops monotonically, and steepest just past the flame', () => {
      const near = falloff(20, 40, 80);
      const middle = falloff(40, 40, 80);
      const far = falloff(60, 40, 80);

      expect(near).toBeGreaterThan(middle);
      expect(middle).toBeGreaterThan(far);
      // Measured clear of the core, or the comparison spans the plateau and
      // says nothing: over equal distances the light gives up far more of
      // itself near the flame than out at the edge, which is what makes the
      // pool read as a pool rather than as a disc.
      expect(falloff(20, 40, 80) - falloff(35, 40, 80))
        .toBeGreaterThan(falloff(60, 40, 80) - falloff(75, 40, 80));
    });

    it('keeps the square the flame stands on properly lit', () => {
      // A short plateau, so a torch's own square is lit rather than merely the
      // brightest of a set of dim ones.
      expect(falloff(10, 40, 80)).toBe(1);
    });
  });
});
