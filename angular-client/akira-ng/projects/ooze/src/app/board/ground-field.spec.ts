import { BoardScene, TerrainTile } from './board.models';
import { GROUND_TEXELS_PER_HALF_FOOT, groundAt, groundField, heightAt } from './ground-field';

/**
 * The shape of the ground, and what it costs.
 *
 * <p>The interesting claim here is a rules claim, not a visual one. The SRD
 * makes a space Difficult Terrain at "a slope of 20 degrees or more" and says
 * nothing about anything gentler — so undulating ground is free, and the board
 * may have as much shape as it likes *provided it stays under that*. Past it,
 * the picture would be showing a hill the engine is not charging for, which is
 * worse than flat ground.
 */
describe('ground field', () => {

  function board(kind: TerrainTile['kind'], cells = 24, base = 0): BoardScene {
    const tiles: TerrainTile[] = [];
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        tiles.push({
          x: x * 10 + 5, y: y * 10 + 5, size: 10, base, height: 0,
          kind, light: 'BRIGHT', opaque: false, cover: 'NONE', rotation: 0,
          colour: 0, baseColour: 0,
        });
      }
    }
    return {
      tiles, tokens: [], props: [],
      widthHalfFeet: cells * 10, heightHalfFeet: cells * 10,
    };
  }

  describe('wear', () => {

    it('reads a road as bare and a meadow as lush', () => {
      expect(groundAt(groundField(board('ROAD')), 100, 100).wear).toBeGreaterThan(0.8);
      expect(groundAt(groundField(board('GRASS')), 100, 100).wear).toBeLessThan(0.2);
    });

    it('calls mud wet, and grass dry', () => {
      expect(groundAt(groundField(board('MUD')), 100, 100).wet).toBeGreaterThan(0.8);
      expect(groundAt(groundField(board('GRASS')), 100, 100).wet).toBe(0);
    });
  });

  describe('shape', () => {

    it('is never steep enough to be Difficult Terrain', () => {
      // Measured over five feet, which is the unit the rules charge in: ten
      // half-feet of run, so twenty degrees is 3.64 half-feet of rise. Anything
      // under that costs a creature nothing, which is what makes all of this
      // decoration rather than a movement penalty nobody asked for.
      const field = groundField(board('GRASS', 40));
      const span = 10;
      const limit = Math.tan((20 * Math.PI) / 180) * span;

      let worst = 0;
      for (let y = span; y < 380; y += span) {
        for (let x = span; x < 380; x += span) {
          worst = Math.max(
            worst,
            Math.abs(heightAt(field, x, y) - heightAt(field, x - span, y)),
            Math.abs(heightAt(field, x, y) - heightAt(field, x, y - span)));
        }
      }
      expect(worst).toBeLessThan(limit);
    });

    it('keeps a rutted road under the threshold too', () => {
      // The road is deliberately much lumpier than the turf — clods, ridges
      // and hollows where water sat — and it still has to read as ground a
      // cart went down rather than as a cliff. Measured cell to cell, which is
      // the unit the rules charge in: bumps inside a square are roughness, not
      // slope, and the SRD has no rule that makes rough ground difficult
      // unless it is rubble.
      const field = groundField(board('ROAD', 40));
      const span = 10;
      const limit = Math.tan((20 * Math.PI) / 180) * span;

      let worst = 0;
      for (let y = span; y < 380; y += span) {
        for (let x = span; x < 380; x += span) {
          worst = Math.max(
            worst,
            Math.abs(heightAt(field, x, y) - heightAt(field, x - span, y)),
            Math.abs(heightAt(field, x, y) - heightAt(field, x, y - span)));
        }
      }
      expect(worst).toBeLessThan(limit);
    });

    it('makes bare ground lumpier than turf', () => {
      // Grass mats over whatever is beneath it and reads smooth; a driven road
      // does not.
      const roughness = (kind: TerrainTile['kind']) => {
        const field = groundField(board(kind, 24));
        let total = 0;
        for (let i = 1; i < field.heights.length; i++) {
          total += Math.abs(field.heights[i] - field.heights[i - 1]);
        }
        return total / field.heights.length;
      };

      expect(roughness('ROAD')).toBeGreaterThan(roughness('GRASS') * 1.5);
    });

    it('has shape at all, rather than being flat with a texture on it', () => {
      // The other half of the same claim: a plane lit from seventy degrees up
      // has nothing to shade, so the ground has to actually vary.
      const field = groundField(board('GRASS', 40));
      // Looped rather than spread: this array is a hundred and fifty thousand
      // floats, and `Math.max(...)` on that is an argument list long enough to
      // misbehave rather than an answer.
      let low = Infinity;
      let high = -Infinity;
      for (const h of field.heights) {
        low = Math.min(low, h);
        high = Math.max(high, h);
      }

      expect(high - low).toBeGreaterThan(1.5);
    });

    it('follows the elevation the squares declare', () => {
      // A hill in the rules has to be a hill in the picture, or the board is
      // lying about where a creature is standing.
      const low = groundField(board('GRASS', 24, 0));
      const high = groundField(board('GRASS', 24, 40));

      expect(heightAt(high, 100, 100) - heightAt(low, 100, 100)).toBeCloseTo(40, 0);
    });

    it('wears the road down below the verge it runs through', () => {
      const field = groundField(board('ROAD', 24));
      const meadow = groundField(board('GRASS', 24));

      expect(heightAt(field, 100, 100)).toBeLessThan(heightAt(meadow, 100, 100));
    });
  });

  it('covers the board at the stated resolution', () => {
    const field = groundField(board('GRASS', 24));

    expect(field.width).toBe(Math.ceil(240 * GROUND_TEXELS_PER_HALF_FOOT));
    expect(field.heights).toHaveLength(field.width * field.height);
  });
});
