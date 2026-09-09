import { BoardPiece, PropPlacement, TerrainKind } from './board.models';
import { WALL_HEIGHT } from './board-scene';

export type { BoardPiece, PropPlacement };

/**
 * Which model stands for which piece of board, and how to sit it on a square.
 *
 * <p><b>A theme is a lookup table, not a dependency.</b> The renderer asks this
 * for a model and draws a primitive when it gets nothing back, so a pack can be
 * deleted from `public/` and the board still works — it just goes back to
 * coloured boxes. That is what "swappable" has to mean if it is going to survive
 * the first time somebody wants their own art: not a switch that has to be
 * flipped everywhere, but an absence that degrades.
 *
 * <p>Nothing here imports three. Themes are data, so a test can assert what a
 * theme claims without a GPU, and a second renderer would read the same table.
 */

/** One model, and what has to happen to it to sit on a 5-foot square. */
export interface PieceModel {
  /** Relative to the app root, so it survives being served from a sub-path. */
  readonly url: string;
  /**
   * Multiplied onto the model before placement.
   *
   * <p>Left at 1 when the theme's own scale is applied globally — see
   * {@link BoardTheme.unitsPerModelUnit}. Set per piece only where one model
   * disagrees with the rest of its pack, which happens.
   */
  readonly scale?: number;
  /** Radians about Z, for a pack whose pieces do not all face the same way. */
  readonly rotation?: number;
  /** Lifted or sunk, in half-feet, for a model whose origin is not at its base. */
  readonly lift?: number;
  /**
   * A height the world fixes, rather than one the model's proportions give.
   *
   * <p>For pieces that have to agree with something the engine already decided.
   * A doorway is cut into an 8-foot wall, so it is 8 feet tall whatever KayKit
   * drew it at — a frame that stopped short of the wall around it would read as
   * a hole in the ceiling.
   */
  readonly heightHalfFeet?: number;
}

export interface BoardTheme {
  readonly id: string;
  readonly name: string;
  /** Shown wherever the board is credited. CC0 packs need none, and say so. */
  readonly attribution: string | null;
  /**
   * How many world units one of the model's own units is.
   *
   * <p>The world unit is the half-foot, so a 5-foot square is 10. Only a
   * fallback: each piece is measured and fitted at load, because a pack states
   * a nominal scale and its pieces still vary. This is what a piece that
   * measures to nothing gets.
   */
  readonly unitsPerModelUnit: number;
  readonly pieces: Partial<Record<BoardPiece, PieceModel>>;
}

const KAYKIT_ROOT = 'assets/board/kaykit';

/**
 * KayKit Dungeon Remastered, CC0.
 *
 * <p>A curated 37 of the pack's 203 pieces — enough to furnish a room rather
 * than merely floor it. Adding another is a line here plus a file; deleting the
 * directory takes the board back to coloured tiles, which is the point.
 *
 * <p><b>Two scales, because the pack disagrees with D&D about how big a tile
 * is.</b> Measured: every floor and wall piece is 4.00 model units across and
 * the walls are 4.00 tall — a square room piece as tall as it is wide, which is
 * a 10-foot dungeon, not a 5-foot one. Floors and walls have to fit the square
 * anyway (the grid is 5 feet and that is not negotiable), so they are scaled
 * 2.5 half-feet per unit. Props are scaled at the pack's own 5 half-feet per
 * unit, so a table comes out 10 feet long and a chair 1.9 — fit a table to a
 * 5-foot square instead and you get a doll's table in a giant's room.
 *
 * <p>So a prop's `scale` below is its width in squares, and is `widest ÷ 2` from
 * the measurement — with a handful knocked down by hand where KayKit's chunky
 * style would otherwise put a 4½-foot barrel in a corridor.
 *
 * <p>Credit is not required by CC0 and is offered anyway, because the pack is
 * good and the author asked nicely.
 */
export const KAYKIT_THEME: BoardTheme = {
  id: 'kaykit',
  name: 'KayKit Dungeon Remastered',
  attribution: 'Dungeon art by Kay Lousberg (kaylousberg.com), CC0',
  unitsPerModelUnit: 2.5,
  pieces: {
    FLOOR: { url: `${KAYKIT_ROOT}/floor_tile_large.gltf.glb` },
    FLOOR_ROUGH: { url: `${KAYKIT_ROOT}/floor_tile_large_rocks.gltf.glb` },
    FLOOR_DIRT: { url: `${KAYKIT_ROOT}/floor_dirt_large.gltf.glb` },
    WALL: { url: `${KAYKIT_ROOT}/wall.gltf.glb` },
    WALL_CORNER: { url: `${KAYKIT_ROOT}/wall_corner.gltf.glb` },
    WALL_ARCH: { url: `${KAYKIT_ROOT}/wall_arched.gltf.glb`, heightHalfFeet: WALL_HEIGHT },
    WALL_TSPLIT: { url: `${KAYKIT_ROOT}/wall_Tsplit.gltf.glb` },
    DOORWAY: { url: `${KAYKIT_ROOT}/wall_doorway.glb`, heightHalfFeet: WALL_HEIGHT },
    // Placed rather than derived. Scale is width in squares; see the note above
    // on why props are drawn at twice the tile scale.
    PILLAR: { url: `${KAYKIT_ROOT}/pillar.gltf.glb`, scale: 0.75 },
    PILLAR_DECORATED: { url: `${KAYKIT_ROOT}/pillar_decorated.gltf.glb`, scale: 1.1 },
    COLUMN: { url: `${KAYKIT_ROOT}/column.gltf.glb`, scale: 0.35 },
    // A fixed rise, not a proportional one. Scaled by width alone a KayKit
    // stair climbs 10.2 feet, so it would overshoot the 5-foot step it serves
    // and end in mid-air — and the engine would happily let a creature walk up
    // and stand there.
    STAIRS: { url: `${KAYKIT_ROOT}/stairs.gltf.glb`, scale: 1.2, heightHalfFeet: 10 },
    BARRIER: { url: `${KAYKIT_ROOT}/barrier.gltf.glb`, scale: 1.2 },
    BARREL: { url: `${KAYKIT_ROOT}/barrel_large.gltf.glb`, scale: 0.6 },
    BARRELS: { url: `${KAYKIT_ROOT}/barrel_small_stack.gltf.glb`, scale: 0.75 },
    CRATE: { url: `${KAYKIT_ROOT}/box_stacked.gltf.glb`, scale: 0.9 },
    CRATES: { url: `${KAYKIT_ROOT}/crates_stacked.gltf.glb`, scale: 1 },
    CHEST: { url: `${KAYKIT_ROOT}/chest_gold.glb`, scale: 0.6 },
    TABLE: { url: `${KAYKIT_ROOT}/table_long.gltf.glb`, scale: 2 },
    TABLE_BROKEN: { url: `${KAYKIT_ROOT}/table_long_broken.gltf.glb`, scale: 2.2 },
    CHAIR: { url: `${KAYKIT_ROOT}/chair.gltf.glb`, scale: 0.38 },
    STOOL: { url: `${KAYKIT_ROOT}/stool.gltf.glb`, scale: 0.38 },
    KEG: { url: `${KAYKIT_ROOT}/keg.gltf.glb`, scale: 0.7 },
    SHELVES: { url: `${KAYKIT_ROOT}/shelves.gltf.glb`, scale: 1 },
    SHELF_CANDLES: { url: `${KAYKIT_ROOT}/shelf_small_candles.gltf.glb`, scale: 0.5 },
    BED: { url: `${KAYKIT_ROOT}/bed_frame.gltf.glb`, scale: 1.5 },
    TORCH: { url: `${KAYKIT_ROOT}/torch_mounted.gltf.glb`, scale: 0.31 },
    CANDLES: { url: `${KAYKIT_ROOT}/candle_triple.gltf.glb`, scale: 0.15 },
    // 8 feet tall at this width, which is exactly a wall — a banner that
    // overhung the wall it hangs on would read as a bug.
    BANNER_BLUE: { url: `${KAYKIT_ROOT}/banner_blue.gltf.glb`, scale: 0.75 },
    BANNER_GREEN: { url: `${KAYKIT_ROOT}/banner_green.gltf.glb`, scale: 0.75 },
    RUBBLE: { url: `${KAYKIT_ROOT}/rubble_large.gltf.glb`, scale: 1.4 },
    RUBBLE_SMALL: { url: `${KAYKIT_ROOT}/rubble_half.gltf.glb`, scale: 1 },
    ARMS: { url: `${KAYKIT_ROOT}/sword_shield.gltf.glb`, scale: 0.8 },
    COINS: { url: `${KAYKIT_ROOT}/coin_stack_large.gltf.glb`, scale: 0.4 },
    TRUNK: { url: `${KAYKIT_ROOT}/trunk_large_A.gltf.glb`, scale: 0.75 },
    BOTTLE: { url: `${KAYKIT_ROOT}/bottle_A_green.gltf.glb`, scale: 0.09 },
    PLATE: { url: `${KAYKIT_ROOT}/plate_food_A.gltf.glb`, scale: 0.2 },
  },
};

/**
 * No models at all.
 *
 * <p>Not a fallback so much as a statement of what the board is without art: it
 * draws, it is legible, and every rule still shows. Worth keeping as a real
 * theme rather than an implicit empty case, because it is what a DM building
 * their own pack starts from, and what a test runs against.
 */
export const PLAIN_THEME: BoardTheme = {
  id: 'plain',
  name: 'Plain',
  attribution: null,
  unitsPerModelUnit: 1,
  pieces: {},
};

export const THEMES: readonly BoardTheme[] = [KAYKIT_THEME, PLAIN_THEME];

export function themeById(id: string): BoardTheme {
  return THEMES.find(t => t.id === id) ?? PLAIN_THEME;
}

/**
 * Which piece a square of terrain should be built from.
 *
 * <p>Terrain kinds the pack has nothing for map to nothing, and the renderer
 * draws its coloured box. Water, lava and a chasm are all better as flat colour
 * than as a wrong-looking floor tile, so they are left unmapped on purpose
 * rather than by omission.
 */
export function pieceFor(kind: TerrainKind): BoardPiece | null {
  switch (kind) {
    case 'FLOOR': return 'FLOOR';
    case 'RUBBLE': return 'FLOOR_ROUGH';
    // Not a mistake: a dirt floor is what mud looks like from above, and the
    // square is still Difficult Terrain because the cell says so and not
    // because of what is drawn on it.
    case 'MUD': return 'FLOOR_DIRT';
    case 'WALL': return 'WALL';
    default: return null;
  }
}

/** The model for a piece in a theme, or null when the theme does not carry it. */
export function modelFor(theme: BoardTheme, piece: BoardPiece | null): PieceModel | null {
  return piece ? theme.pieces[piece] ?? null : null;
}

/** Every file a theme needs, for preloading or for checking they are all there. */
export function modelUrls(theme: BoardTheme): string[] {
  return Object.values(theme.pieces).map(p => p.url);
}
