import { BoardPiece, PropPlacement, TerrainKind } from './board.models';
import { ScatterKind } from './scatter';
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

/**
 * The light a theme brings with it.
 *
 * <p>Part of the theme rather than the renderer, because the light *is* art
 * direction: a cellar capture and a bright studio are two different rooms, not
 * two settings. Swapping the pack should swap the mood with it.
 *
 * @param intensity how hard it drives the scene. One is the capture as
 *     measured; a dungeon usually wants less, so the local light a DM places
 *     has something to be brighter than.
 */
export interface BoardEnvironment {
  readonly url: string;
  readonly intensity: number;
}

/** One physically-based material set, and how big a tile of it is. */
export interface GroundLayer {
  readonly colour: string;
  readonly normal: string;
  /** Ambient occlusion, roughness and metalness packed into R, G and B. */
  readonly arm: string;
  /** Feet across one repeat. Too small and it visibly tiles; too big and it blurs. */
  readonly feet: number;
  /**
   * Multiplied onto the scan's own colour, as r,g,b.
   *
   * <p>Because a scan is of one particular place. Poly Haven's dirt was
   * photographed somewhere with pale sandy soil; the Virginia piedmont is red
   * clay, and the difference between the two is most of what makes a road look
   * like it is *somewhere*. Tinting is honest here in a way that repainting
   * would not be — the relief and the roughness are still measured, and only
   * the colour is being placed.
   */
  readonly tint?: readonly [number, number, number];
}

/**
 * Ground painted from real materials rather than built out of tiles.
 *
 * <p>Three layers, blended per pixel by how worn the ground is: lush, thin, and
 * bare. A road has no edges — the verge beside a cart track is grass that gets
 * thinner for a few feet and then gives up — and no arrangement of square tiles
 * can say that.
 */
export interface SplatGround {
  readonly kind: 'splat';
  readonly layers: readonly [GroundLayer, GroundLayer, GroundLayer];
  /**
   * Models for the things lying on it.
   *
   * <p>Absent leaves the ground bare, which is a supported state and looks
   * exactly like what it is: a printed surface. Nothing real is smooth for a
   * hundred feet in every direction.
   */
  readonly scatter?: Partial<Record<ScatterKind, string>>;
}

/**
 * How a board is lit and graded — the art direction, not the assets.
 *
 * <p>On the theme because it belongs to the theme. A torchlit cellar and a
 * summer afternoon are not the same scene with different textures in it: the
 * cellar wants a dim ambient, a warm key and a heavy vignette, and applying any
 * of that to a field at one o'clock gives you a field at dusk. Which is exactly
 * what happened the first time the outdoor ground was drawn with the dungeon's
 * numbers.
 *
 * @param elevation the sun's angle above the horizon, in degrees
 * @param azimuth its compass bearing — 180 is due south
 */
export interface BoardLook {
  readonly exposure: number;
  readonly ambient: number;
  readonly sun: {
    readonly intensity: number;
    readonly colour: number;
    readonly elevation: number;
    readonly azimuth: number;
  };
  readonly saturation: number;
  readonly contrast: number;
  readonly vignette: number;
  /** How much dust hangs in the air, as a multiple of the usual amount. */
  readonly motes: number;
}

/** A torchlit interior: the values the dungeon was tuned to. */
export const INDOOR_LOOK: BoardLook = {
  exposure: 0.95,
  ambient: 0.08,
  sun: { intensity: 0.95, colour: 0xffe9cc, elevation: 68, azimuth: 145 },
  saturation: 1.16,
  contrast: 1.06,
  vignette: 0.34,
  motes: 1,
};

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
  /**
   * Image-based lighting, if the pack ships any.
   *
   * <p>Absent is fine — the renderer falls back to a generated room, and the
   * board is never unlit.
   */
  readonly environment?: BoardEnvironment;
  /**
   * Whether the sky is drawn behind the board.
   *
   * <p>Indoors it must not be: a dungeon with a horizon is a dungeon on a
   * hilltop. Outdoors it is most of what tells you which one you are looking at.
   */
  readonly sky?: boolean;
  /** Absent means {@link INDOOR_LOOK}, which is what a dungeon wants. */
  readonly look?: BoardLook;
  /**
   * How the ground is made. Absent means the old way — one piece per square,
   * chosen by its terrain — which is right for a dungeon and wrong for a field.
   */
  readonly ground?: SplatGround;
  readonly pieces: Partial<Record<BoardPiece, PieceModel>>;
}

const KAYKIT_ROOT = 'assets/board/kaykit';
const HDRI_ROOT = 'assets/board/hdri';

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
  attribution: 'Dungeon art by Kay Lousberg (kaylousberg.com) and lighting by '
    + 'Andreas Mischok (polyhaven.com), both CC0',
  unitsPerModelUnit: 2.5,
  // A chapel basement, which is as close to a crypt as a real capture gets.
  // Medium contrast on purpose: a high-contrast interior is one bright window,
  // and one bright window fights the sun for authorship of the whole board.
  environment: { url: `${HDRI_ROOT}/sepulchral_chapel_basement_1k.hdr`, intensity: 0.85 },
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

const PH_ROOT = 'assets/board/polyhaven';
const SCATTER_ROOT = 'assets/board/scatter';

function layer(
  name: string, feet: number, tint?: readonly [number, number, number],
): GroundLayer {
  return {
    colour: `${PH_ROOT}/${name}_diff_1k.jpg`,
    normal: `${PH_ROOT}/${name}_nor_gl_1k.jpg`,
    arm: `${PH_ROOT}/${name}_arm_1k.jpg`,
    feet,
    tint,
  };
}

/**
 * Open country, from Poly Haven scans.
 *
 * <p>The other half of the argument the dungeon pack makes. KayKit is drawn:
 * flat colour off one hand-painted atlas, stylised on purpose, and no amount of
 * lighting will make its stone look like stone because there is no surface
 * detail in it to light. These are measured: colour, relief and roughness from
 * a real surface, which is what lets a low sun rake across a rut or a high one
 * pick out the grain of dry dirt.
 *
 * <p>Three layers on purpose, not two. Grass and dirt alone meet at a line
 * wherever they meet; the thin, half-dead stuff in between is what a verge
 * actually is, and it is the layer that makes a road look used rather than
 * drawn.
 *
 * <p>1k rather than 2k, and it is not a compromise: each repeat covers a few
 * feet, so a whole board is a dozen repeats across, and at the resolution this
 * renders at nothing on screen is asking for more texels than that.
 */
export const FIELD_THEME: BoardTheme = {
  id: 'polyhaven-field',
  name: 'Open country',
  attribution: 'Ground and sky from Poly Haven (polyhaven.com), CC0',
  unitsPerModelUnit: 2.5,
  environment: { url: `${PH_ROOT}/qwantani_noon_puresky_2k.hdr`, intensity: 1.05 },
  sky: true,
  // One o'clock, mid-July, about the latitude of Richmond: the sun is around
  // seventy degrees up and just west of south, so shadows are short and fall
  // north-north-east. Bright, barely graded, and almost no vignette — a summer
  // afternoon is not a mood, it is an absence of one.
  look: {
    exposure: 1.15,
    ambient: 0.22,
    sun: { intensity: 2.7, colour: 0xfff4e2, elevation: 70, azimuth: 197 },
    saturation: 1.08,
    contrast: 1.02,
    vignette: 0.1,
    // A little pollen in the air and no more. At the dungeon's density, white
    // specks over a lit meadow read as dirt on the lens.
    motes: 0.22,
  },
  ground: {
    kind: 'splat',
    layers: [
      // Feet per repeat, picked by eye against a five-foot square: grass reads
      // as blades at this size, and dirt as ruts rather than as gravel.
      // Midsummer, so the grass is pushed green and away from the scan's
      // late-season yellow; the bare ground is pushed toward red clay, which is
      // what the road between Richmond and Fredericksburg is cut through.
      layer('leafy_grass', 7, [0.88, 1.06, 0.72]),
      layer('sparse_grass', 8, [1.0, 1.0, 0.82]),
      layer('dirt_floor', 10, [1.06, 0.78, 0.58]),
    ],
    scatter: {
      // rock_07 and not rock_09: the latter measures seven centimetres by
      // three, which is a pebble, and a pebble on a board seen from sixty feet
      // up is nothing at all.
      STONE: `${SCATTER_ROOT}/rock_07/rock_07.gltf`,
      BRANCH: `${SCATTER_ROOT}/dry_branches_medium_01/dry_branches_medium_01.gltf`,
    },
  },
  pieces: {},
};

export const THEMES: readonly BoardTheme[] = [KAYKIT_THEME, FIELD_THEME, PLAIN_THEME];

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
