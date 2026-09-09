import { TerrainKind } from './board.models';

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

/** The pieces a board is built from, named by what they are rather than by file. */
export type BoardPiece =
  | 'FLOOR'
  | 'FLOOR_ROUGH'
  | 'WALL'
  | 'WALL_CORNER'
  | 'DOORWAY'
  | 'PILLAR'
  | 'STAIRS'
  | 'COLUMN';

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
}

export interface BoardTheme {
  readonly id: string;
  readonly name: string;
  /** Shown wherever the board is credited. CC0 packs need none, and say so. */
  readonly attribution: string | null;
  /**
   * How many world units one of the model's own units is.
   *
   * <p>The world unit is the half-foot, so a 5-foot square is 10. KayKit's
   * pieces are authored one-per-tile at roughly a metre, and a 5-foot square is
   * about 1.5 m — so one model unit is about 6.5 half-feet. Kept here rather
   * than baked into each entry, because re-sourcing a pack should be one number
   * and not two hundred.
   */
  readonly unitsPerModelUnit: number;
  readonly pieces: Partial<Record<BoardPiece, PieceModel>>;
}

const KAYKIT_ROOT = 'assets/board/kaykit';

/**
 * KayKit Dungeon Remastered, CC0.
 *
 * <p>A curated handful rather than all 203 pieces: the board needs floors,
 * walls and a couple of props to stop looking like a spreadsheet, and vendoring
 * a whole pack for eight files in use is weight nobody asked for. Adding more is
 * a line here plus a file.
 *
 * <p>Credit is not required by CC0 and is offered anyway, because the pack is
 * good and the author asked nicely.
 */
export const KAYKIT_THEME: BoardTheme = {
  id: 'kaykit',
  name: 'KayKit Dungeon Remastered',
  attribution: 'Dungeon art by Kay Lousberg (kaylousberg.com), CC0',
  unitsPerModelUnit: 6.5,
  pieces: {
    FLOOR: { url: `${KAYKIT_ROOT}/floor_tile_large.gltf.glb` },
    FLOOR_ROUGH: { url: `${KAYKIT_ROOT}/floor_tile_large_rocks.gltf.glb` },
    WALL: { url: `${KAYKIT_ROOT}/wall.gltf.glb` },
    WALL_CORNER: { url: `${KAYKIT_ROOT}/wall_corner.gltf.glb` },
    DOORWAY: { url: `${KAYKIT_ROOT}/wall_doorway.glb` },
    PILLAR: { url: `${KAYKIT_ROOT}/pillar.gltf.glb` },
    STAIRS: { url: `${KAYKIT_ROOT}/stairs.gltf.glb` },
    COLUMN: { url: `${KAYKIT_ROOT}/column.gltf.glb` },
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
