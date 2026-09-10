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
 * <p>Eight across a five-foot square. It was four, and four is not enough to
 * blur over: a square's own light showed *as a square*, with a hard step at
 * every room boundary and a torch sitting in the middle of a lit tile like a
 * lamp in a box. A whole 130-by-100-foot level is 208 by 160 — 133 KB, rebuilt
 * in a millisecond, and still not the thing worth optimising.
 */
export const TEXELS_PER_HALF_FOOT = 0.8;

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
  // Near-neutral and faintly warm, not blue. Dim was blue when it meant "this
  // room is unlit"; it now means "this room is lit by what is standing in it",
  // which is the state most of a dungeon is in — and a blue base under warm
  // stone turned every room grey-green the moment it stopped being the
  // exception.
  DIM: [0.5, 0.47, 0.45],
  // Lifted once, after looking at an unlit crypt on a graded, tone-mapped
  // board and failing to make out the floor. A DM has to be able to read a dark
  // room; the creatures in it are the ones who cannot see.
  DARKNESS: [0.18, 0.2, 0.29],
};

/** What a flame adds, on top of whatever the square's level already was. */
export const FLAME_COLOUR: readonly [number, number, number] = [1, 0.6, 0.26];

/** One thing that burns: how far it reaches and how hard. */
export interface LightSource {
  /** Half-feet of full brightness. */
  readonly bright: number;
  /** Half-feet at which it has died entirely. */
  readonly dim: number;
  readonly strength: number;
}

/**
 * How far a light reaches, in half-feet: full out to the first, gone by the
 * second.
 *
 * <p>The SRD's own numbers. A torch "casts Bright Light in a 20-foot radius and
 * Dim Light for an additional 20 feet", so the ramp is not a lighting artist's
 * choice — it is the rule, drawn.
 */
const REACH: Partial<Record<PropKind, LightSource>> = {
  // Strong enough to be the thing lighting the room rather than a highlight on
  // a room that was already lit. That is the difference between a dungeon and a
  // diagram of one — and it is why the sample level's rooms are Dim now: a
  // torchlit hall *is* dim, twenty feet from a torch.
  TORCH: { bright: 40, dim: 80, strength: 0.95 },
  CANDLES: { bright: 10, dim: 20, strength: 0.35 },
  SHELF_CANDLES: { bright: 10, dim: 20, strength: 0.35 },
};

/**
 * How far the light is smeared sideways, in texels either way, per pass.
 *
 * <p>Three passes of five taps is about six texels — three quarters of a
 * square. Enough to turn the step between a lit room and a dim corridor into a
 * falloff, and not so much that a room loses its shape.
 */
const BLUR_RADIUS = 2;
const BLUR_PASSES = 3;

/** Whether a prop is on fire, and how brightly. Null for anything that is not. */
export function lightSource(piece: PropKind): LightSource | null {
  return REACH[piece] ?? null;
}

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
  const solid = new Uint8Array(width * height);

  paintLevels(board.tiles, rgb, solid, width, height,
    board.widthHalfFeet, board.heightHalfFeet);
  addFlames(board, rgb, width, height);
  for (let i = 0; i < BLUR_PASSES; i++) {
    blur(rgb, solid, width, height);
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
  solid: Uint8Array,
  width: number,
  height: number,
  extentX: number,
  extentY: number,
): void {
  for (const tile of tiles) {
    const colour = LEVEL_COLOUR[tile.light];
    const wall = tile.height > 0;
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
        if (wall) {
          solid[y * width + x] = 1;
        }
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
    const reach = lightSource(prop.piece);
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
 * Brightest at the flame, falling away to nothing at its outer edge.
 *
 * <p><b>The SRD's radii are a rules abstraction, not an intensity curve</b>,
 * and using them as one is what made a torchlit room look flat. "Bright Light
 * in a 20-foot radius" means a creature 19 feet away can see as if in daylight;
 * it does not mean the floor 19 feet away is as bright as the floor under the
 * flame. Held at full strength across the whole bright radius, a dozen torches
 * in a level overlap into an even wash and nothing reads as a light source at
 * all — which is the opposite of the point of placing them.
 *
 * <p>So the *rules* keep the radii and the *picture* gets a falloff: a small
 * core at full strength, then quadratic to nothing at the dim edge. Quadratic
 * because that is roughly what light does, and because it puts the visible
 * change close to the flame where an eye reads it as a pool.
 */
export function falloff(distance: number, bright: number, dim: number): number {
  if (distance >= dim || dim <= 0) {
    return 0;
  }
  // A short plateau, so the square a torch stands on is properly lit rather
  // than merely the brightest of a set of dim ones.
  const core = bright * 0.35;
  if (distance <= core) {
    return 1;
  }
  const t = (dim - distance) / (dim - core);
  return t * t;
}

/**
 * A three-tap box blur, separably, in place.
 *
 * <p>Turns the steps between squares into gradients. Kept to one texel — two
 * and a half feet — on purpose: wider looks lovely on open floor and bleeds
 * torchlight through walls, and a wall is four texels thick, so at this radius
 * the light dies inside the stone where it belongs.
 */
function blur(rgb: Float32Array, solid: Uint8Array, width: number, height: number): void {
  const scratch = new Float32Array(rgb.length);
  sweep(rgb, scratch, solid, width, height, 1, 0);
  sweep(scratch, rgb, solid, width, height, 0, 1);
}

function sweep(
  from: Float32Array,
  into: Float32Array,
  solid: Uint8Array,
  width: number,
  height: number,
  stepX: number,
  stepY: number,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centre = y * width + x;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let step = -BLUR_RADIUS; step <= BLUR_RADIUS; step++) {
        const sx = x + step * stepX;
        const sy = y + step * stepY;
        const inside = sx >= 0 && sx < width && sy >= 0 && sy < height;
        // Off the board, or across the face of a wall: fall back to this
        // texel's own value. That keeps the average honest without letting
        // anything leak between a room and what is on the far side of its
        // stone.
        const source = inside && solid[sy * width + sx] === solid[centre]
          ? (sy * width + sx) * 3
          : centre * 3;
        r += from[source];
        g += from[source + 1];
        b += from[source + 2];
      }
      const taps = BLUR_RADIUS * 2 + 1;
      const at = centre * 3;
      into[at] = r / taps;
      into[at + 1] = g / taps;
      into[at + 2] = b / taps;
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
