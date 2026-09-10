import {
  CAST, SAMPLE_HEIGHT, SAMPLE_WIDTH, sampleMap, toCombatant, worldRow,
} from './sample-level';

/**
 * The sample level, checked against what the server will accept.
 *
 * <p>This became worth testing the moment the level stopped being a fixture and
 * started being something a DM can POST. The server caps a board at 60 squares
 * a side and 400 props, refuses a prop off the edge of the board, and refuses a
 * cell off it too — so a level that drifts past any of those turns "From the
 * sample dungeon" into a 400 with no warning until somebody clicks it.
 *
 * <p>The numbers below are duplicated from the server on purpose. A shared
 * constant would be nice and there is no honest way to have one across the two
 * languages; a test that fails when the fixture outgrows the contract is the
 * next best thing, and it names the contract in one place.
 */
describe('the sample level', () => {

  /** `BattleMapRequest`: `@Min(1) @Max(60)` on both sides. */
  const MAX_SIDE = 60;
  /** `EncounterService.MAX_PROPS`. */
  const MAX_PROPS = 400;

  const map = sampleMap();

  it('fits on a board the server will accept', () => {
    expect(SAMPLE_WIDTH).toBeGreaterThan(0);
    expect(SAMPLE_WIDTH).toBeLessThanOrEqual(MAX_SIDE);
    expect(SAMPLE_HEIGHT).toBeGreaterThan(0);
    expect(SAMPLE_HEIGHT).toBeLessThanOrEqual(MAX_SIDE);
  });

  it('draws its two pictures at the same size', () => {
    // The terrain and the light are separate grids read in step. One row longer
    // than the other silently lights the wrong squares from that row on.
    expect(map.cells.every(c => c.x < SAMPLE_WIDTH && c.y < SAMPLE_HEIGHT)).toBe(true);
  });

  it('stores only the squares that differ from the map defaults', () => {
    // Sparse storage is the point of the cell table. A level that emitted every
    // square would still render and would be five hundred rows of nothing.
    expect(map.cells.length).toBeLessThan(SAMPLE_WIDTH * SAMPLE_HEIGHT);
    expect(map.cells.length).toBeGreaterThan(100);
  });

  it('carries furniture, and less of it than a board may hold', () => {
    expect(map.props.length).toBeGreaterThan(50);
    expect(map.props.length).toBeLessThanOrEqual(MAX_PROPS);
  });

  it('keeps every prop on the board, in half-feet', () => {
    // The server checks props against the board's real extent rather than
    // against a cell index, and refuses rather than clamping — a table half off
    // the map is a bug in whatever produced it, which here is this file.
    const widthHalfFeet = SAMPLE_WIDTH * map.cellFeet * 2;
    const heightHalfFeet = SAMPLE_HEIGHT * map.cellFeet * 2;

    for (const prop of map.props) {
      expect(prop.xHalfFeet).toBeGreaterThanOrEqual(0);
      expect(prop.yHalfFeet).toBeGreaterThanOrEqual(0);
      expect(prop.xHalfFeet).toBeLessThan(widthHalfFeet);
      expect(prop.yHalfFeet).toBeLessThan(heightHalfFeet);
    }
  });

  it('faces every prop in a whole number of degrees the server will take', () => {
    // `@Min(0) @Max(359)`. The mirror that maps picture space to world space
    // negates a rotation, and a naive negation produces -90.
    for (const prop of map.props) {
      expect(prop.facingDegrees).toBeGreaterThanOrEqual(0);
      expect(prop.facingDegrees).toBeLessThanOrEqual(359);
      expect(Number.isInteger(prop.facingDegrees)).toBe(true);
    }
  });

  it('puts every creature on the board too', () => {
    const widthHalfFeet = SAMPLE_WIDTH * map.cellFeet * 2;
    const heightHalfFeet = SAMPLE_HEIGHT * map.cellFeet * 2;

    for (const member of CAST) {
      const placed = toCombatant(member);
      expect(placed.xHalfFeet).toBeGreaterThanOrEqual(0);
      expect(placed.xHalfFeet).toBeLessThan(widthHalfFeet);
      expect(placed.yHalfFeet).toBeGreaterThanOrEqual(0);
      expect(placed.yHalfFeet).toBeLessThan(heightHalfFeet);
    }
  });

  it('mirrors picture rows onto world rows, and back', () => {
    // The pictures are drawn north-up and the world's +Y is north, so the first
    // row of the picture is the highest y. Getting this wrong rendered the
    // whole level upside down with every room in the wrong half.
    expect(worldRow(0)).toBe(SAMPLE_HEIGHT - 1);
    expect(worldRow(SAMPLE_HEIGHT - 1)).toBe(0);
    // Fractions are half-squares, and south in the picture is down in the world.
    expect(worldRow(1.3)).toBeCloseTo(SAMPLE_HEIGHT - 2.3);
  });
});
