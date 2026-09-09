import { BoardScene, LightLevel, PropKind, TerrainTile } from './board.models';

/**
 * The light on the board, as a picture of it.
 *
 * <p><b>Why a texture and not lights.</b> A dungeon wants a lamp on every torch
 * — that is most of what makes one look like a dungeon rather than a diorama —
 * and a renderer wants nothing of the sort: every real light costs shader work
 * on every surface, and a shadow-casting point light costs six renders of the
 * scene. Twenty torches is not a lighting rig, it is a slideshow.
 *
 * <p>So the light is baked into a small image over the board and sampled once
 * per pixel. Two hundred lights cost exactly what two do, the falloff is
 * whatever shape we say it is, and it composes with the environment map and the
 * sun instead of competing with them.
 *
 * <p><b>It replaces a black quad over every dim square.</b> That hack flattened
 * everything under it — a 78% black film removes all the shading it covers, so
 * the darkest rooms were also the ones with no visible form at all — and it
 * could only ever subtract. This can subtract, tint and *add*, so an unlit crypt
 * goes cold and blue while the torch by the door throws a warm pool across the
 * floor.
 *
 * <p>Pure, and names three nowhere, for the same reason the scene builder does:
 * jsdom has no WebGL context, so a rule proved inside a renderer is a rule that
 * cannot be tested at all.
 */

/**
 * Texels per half-foot.
 *
 * <p>0.4 puts four across a five-foot square, which the GPU's linear filtering
 * turns into a smooth gradient. A whole 130-by-100-foot level is 104 by 80 —
 * 33 KB, rebuilt in a millisecond, small enough that the resolution is never the
 * thing worth optimising.
 */
export const TEXELS_PER_HALF_FOOT = 0.4;

/**
 * What one byte of the field means.
 *
 * <p>Two, not one, so a torch can be brighter than white paper. The tone curve
 * rolls the excess off into a warm highlight instead of clipping it flat, which
 * is what a flame is supposed to do — and it is the headroom a bloom pass would
 * later look for.
 */
export const LIGHT_RANGE = 2;

/**
 * The colour of each light level, in linear RGB.
 *
 * <p>Not greys. Unlit is *blue*, because that is how an eye reports a room it
 * cannot see — and because a DM still has to read the board, so darkness has to
 * be dark and legible rather than black. Bright is faintly warm, so a lit room
 * and an unlit one differ in temperature and not only in level; that difference
 * is most of what separates a painted scene from a dimmed one.
 */
const LEVEL_COLOUR: Record<LightLevel, readonly [number, number, number]> = {
  BRIGHT: [1, 0.97, 0.9],
  DIM: [0.42, 0.44, 0.55],
  DARKNESS: [0.13, 0.15, 0.24],
};

/** What a flame adds, on top of whatever the square's level already was. */
const FLAME_COLOUR: readonly [number, number, number] = [1, 0.6, 0.26];

/**
 * How far a light reaches, in half-feet: full out to the first, gone by the
 * second.
 *
 * <p>The SRD's own numbers. A torch "casts Bright Light in a 20-foot radius and
 * Dim Light for an additional 20 feet", so the ramp is not a lighting artist's
 * choice — it is the rule, drawn.
 */
const REACH: Partial<Record<PropKind, { bright: number; dim: number; strength: number }>> = {
  TORCH: { bright: 40, dim: 80, strength: 0.55 },
  CANDLES: { bright: 10, dim: 20, strength: 0.3 },
  SHELF_CANDLES: { bright: 10, dim: 20, strength: 0.3 },
};

/** How far light bleeds sideways, in texels, to turn steps into gradients. */
const BLUR_PASSES = 2;

export interface LightField {
  readonly width: number;
  readonly height: number;
  /** Half-feet the image spans, so a sampler can turn a position into a texel. */
  readonly extentXHalfFeet: number;
  readonly extentYHalfFeet: number;
  /** RGBA, one byte a channel, where 255 is {@link LIGHT_RANGE} times full. */
  readonly data: Uint8Array;
}

/** The light over a board: its squares' levels, plus everything burning on it. */
export function lightField(board: BoardScene): LightField {
  const width = Math.max(1, Math.ceil(board.widthHalfFeet * TEXELS_PER_HALF_FOOT));
  const height = Math.max(1, Math.ceil(board.heightHalfFeet * TEXELS_PER_HALF_FOOT));
  const rgb = new Float32Array(width * height * 3);

  paintLevels(board.tiles, rgb, width, height, board.widthHalfFeet, board.heightHalfFeet);
  addFlames(board, rgb, width, height);
  for (let i = 0; i < BLUR_PASSES; i++) {
    blur(rgb, width, height);
  }

  return {
    width,
    height,
    extentXHalfFeet: board.widthHalfFeet,
    extentYHalfFeet: board.heightHalfFeet,
    data: quantise(rgb),
  };
}

/**
 * Every square's own light level, stamped over the texels it covers.
 *
 * <p>Per square rather than interpolated between square centres: a light level
 * is a property of the square, and a doorway from a bright hall into a dark
 * crypt should darken at the doorway rather than half a room early. The blur
 * afterwards is what keeps that from being a hard line.
 */
function paintLevels(
  tiles: readonly TerrainTile[],
  rgb: Float32Array,
  width: number,
  height: number,
  extentX: number,
  extentY: number,
): void {
  for (const tile of tiles) {
    const colour = LEVEL_COLOUR[tile.light];
    const half = tile.size / 2;
    const x0 = texel(tile.x - half, extentX, width);
    const x1 = texel(tile.x + half, extentX, width);
    const y0 = texel(tile.y - half, extentY, height);
    const y1 = texel(tile.y + half, extentY, height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const at = (y * width + x) * 3;
        rgb[at] = colour[0];
        rgb[at + 1] = colour[1];
        rgb[at + 2] = colour[2];
      }
    }
  }
}

/**
 * What is actually burning, added on top.
 *
 * <p>Added rather than maxed, so a torch in an already-bright hall still reads
 * as a torch — a pool a little hotter and a lot warmer than the room around it.
 * That is the whole difference between a lit room and a room with lights in it.
 */
function addFlames(
  board: BoardScene,
  rgb: Float32Array,
  width: number,
  height: number,
): void {
  for (const prop of board.props) {
    const reach = REACH[prop.piece];
    if (!reach) {
      continue;
    }
    const cx = (prop.x / board.widthHalfFeet) * width;
    const cy = (prop.y / board.heightHalfFeet) * height;
    const radius = reach.dim * TEXELS_PER_HALF_FOOT;
    const bright = reach.bright * TEXELS_PER_HALF_FOOT;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(height - 1, Math.ceil(cy + radius));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const fall = falloff(distance, bright, radius) * reach.strength;
        if (fall <= 0) {
          continue;
        }
        const at = (y * width + x) * 3;
        rgb[at] += FLAME_COLOUR[0] * fall;
        rgb[at + 1] += FLAME_COLOUR[1] * fall;
        rgb[at + 2] += FLAME_COLOUR[2] * fall;
      }
    }
  }
}

/**
 * Full inside the bright radius, easing to nothing at the dim edge.
 *
 * <p>Smoothed rather than linear because a linear ramp has a visible crease at
 * both ends, and a crease in a pool of torchlight is the one place an eye is
 * guaranteed to be looking.
 */
export function falloff(distance: number, bright: number, dim: number): number {
  if (distance <= bright) {
    return 1;
  }
  if (distance >= dim || dim <= bright) {
    return 0;
  }
  const t = (distance - bright) / (dim - bright);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * A three-tap box blur, separably, in place.
 *
 * <p>Turns the steps between squares into gradients. Kept to one texel — two
 * and a half feet — on purpose: wider looks lovely on open floor and bleeds
 * torchlight through walls, and a wall is four texels thick, so at this radius
 * the light dies inside the stone where it belongs.
 */
function blur(rgb: Float32Array, width: number, height: number): void {
  const scratch = new Float32Array(rgb.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      const left = (y * width + Math.max(0, x - 1)) * 3;
      const right = (y * width + Math.min(width - 1, x + 1)) * 3;
      for (let c = 0; c < 3; c++) {
        scratch[at + c] = (rgb[left + c] + rgb[at + c] + rgb[right + c]) / 3;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      const up = (Math.max(0, y - 1) * width + x) * 3;
      const down = (Math.min(height - 1, y + 1) * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        rgb[at + c] = (scratch[up + c] + scratch[at + c] + scratch[down + c]) / 3;
      }
    }
  }
}

/** Which texel a position in half-feet falls in, clamped to the image. */
function texel(halfFeet: number, extent: number, size: number): number {
  const at = Math.round((halfFeet / extent) * size);
  return Math.max(0, Math.min(size, at));
}

/** Float radiance to the bytes a texture holds, scaled by {@link LIGHT_RANGE}. */
function quantise(rgb: Float32Array): Uint8Array {
  const out = new Uint8Array((rgb.length / 3) * 4);
  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
    out[o] = clampByte(rgb[i]);
    out[o + 1] = clampByte(rgb[i + 1]);
    out[o + 2] = clampByte(rgb[i + 2]);
    out[o + 3] = 255;
  }
  return out;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round((value / LIGHT_RANGE) * 255)));
}

/** The light at a point, for a test or a tooltip. Mirrors what the shader does. */
export function lightAt(field: LightField, xHalfFeet: number, yHalfFeet: number):
    [number, number, number] {
  const x = Math.max(0, Math.min(field.width - 1,
    Math.floor((xHalfFeet / field.extentXHalfFeet) * field.width)));
  const y = Math.max(0, Math.min(field.height - 1,
    Math.floor((yHalfFeet / field.extentYHalfFeet) * field.height)));
  const at = (y * field.width + x) * 4;
  return [
    (field.data[at] / 255) * LIGHT_RANGE,
    (field.data[at + 1] / 255) * LIGHT_RANGE,
    (field.data[at + 2] / 255) * LIGHT_RANGE,
  ];
}
