import { BoardScene, TerrainTile } from './board.models';

/**
 * How worn, and how wet, every part of the ground is.
 *
 * <p>The outdoor sibling of {@link ./light-field}, and the same idea: something
 * that varies continuously across a board, baked into a small image the shader
 * samples once. Here it decides which *material* the ground is made of at a
 * point — lush grass, grass somebody has walked the life out of, or bare dirt —
 * rather than how much light reaches it.
 *
 * <p><b>Why a field and not a per-square choice.</b> A road does not have edges.
 * The verge beside a cart track is not grass up to a line and dirt after it; it
 * is grass that gets thinner for a few feet and then gives up. Painting the
 * material per square would put that line back, and it is exactly the line that
 * says "tiles" to anyone looking.
 *
 * <p>So the squares say what they are, this smears the answer, and a little
 * noise makes the boundary ragged the way a real one is — worn away faster
 * where the carts swing wide, holding on longer in the lee of things.
 */

/** Texels per half-foot. Sixteen across a five-foot square: this is what you see. */
export const GROUND_TEXELS_PER_HALF_FOOT = 1.6;

/** How far wear bleeds sideways, in texels either way, per pass. */
const BLUR_RADIUS = 3;
const BLUR_PASSES = 4;

/**
 * How deep a fully worn rut sits below the verge, in half-feet.
 *
 * <p>Here rather than in the renderer because three things have to agree about
 * it: the mesh that is displaced, the stones that sit on that mesh, and
 * anything later that asks how high the ground is at a point.
 */
export const RUT_DEPTH = 0.9;

export interface GroundField {
  readonly width: number;
  readonly height: number;
  readonly extentXHalfFeet: number;
  readonly extentYHalfFeet: number;
  /**
   * How high the ground is at each texel, in half-feet.
   *
   * <p><b>Real shape, not a normal map.</b> A flat plane lit from seventy
   * degrees up has almost nothing to shade — which is why the water on this
   * board looked real and the grass did not: water has a surface that answers
   * to light, and a texture pretending to have one does not. Geometry catches
   * the sun at a different angle everywhere, casts its own shadows, and breaks
   * its own silhouette.
   *
   * <p>And it is free in the rules. The SRD makes a space Difficult Terrain at
   * "a slope of 20 degrees or more" and says nothing about anything gentler, so
   * ground that rolls under that threshold costs a creature exactly nothing —
   * which is asserted, rather than hoped, in the tests.
   */
  readonly heights: Float32Array;
  /**
   * RGBA. Red is wear — 0 lush, 255 bare. Green is wet. Blue is a slow
   * variation across the whole board, which is what stops a tiling texture from
   * reading as a tiling texture.
   */
  readonly data: Uint8Array;
}

/** How worn a square starts out, before anything is smeared or roughened. */
function wearOf(tile: TerrainTile): number {
  switch (tile.kind) {
    case 'ROAD': return 1;
    // Mud is a road that has been rained on and driven through since.
    case 'MUD': return 1;
    case 'RUBBLE': return 0.75;
    case 'GRASS': return 0;
    // Anything indoors, or anything this field has no opinion about, is bare.
    default: return 0.85;
  }
}

function wetOf(tile: TerrainTile): number {
  switch (tile.kind) {
    case 'MUD': return 1;
    case 'WATER': return 1;
    case 'DEEP_WATER': return 1;
    default: return 0;
  }
}

export function groundField(board: BoardScene): GroundField {
  const width = Math.max(1, Math.ceil(board.widthHalfFeet * GROUND_TEXELS_PER_HALF_FOOT));
  const height = Math.max(1, Math.ceil(board.heightHalfFeet * GROUND_TEXELS_PER_HALF_FOOT));
  const wear = new Float32Array(width * height);
  const wet = new Float32Array(width * height);
  const ground = new Float32Array(width * height);

  for (const tile of board.tiles) {
    const half = tile.size / 2;
    const x0 = texel(tile.x - half, board.widthHalfFeet, width);
    const x1 = texel(tile.x + half, board.widthHalfFeet, width);
    const y0 = texel(tile.y - half, board.heightHalfFeet, height);
    const y1 = texel(tile.y + half, board.heightHalfFeet, height);
    const w = wearOf(tile);
    const damp = wetOf(tile);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        wear[y * width + x] = w;
        wet[y * width + x] = damp;
        // The square's own elevation, which the mesh has to follow or a hill
        // is a hill in the rules and a flat patch in the picture.
        ground[y * width + x] = tile.base;
      }
    }
  }

  for (let i = 0; i < BLUR_PASSES; i++) {
    smear(wear, width, height);
    smear(wet, width, height);
    smear(ground, width, height);
  }
  roughen(wear, width, height);
  shapeGround(ground, wear, width, height);

  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      data[i * 4] = clampByte(wear[i]);
      data[i * 4 + 1] = clampByte(wet[i]);
      // Two slow octaves, tens of feet across. Real ground is not one colour:
      // it is drier on the rises and ranker in the hollows, and without
      // something at that scale a perfectly good scanned texture repeats
      // visibly and the eye reads the repeat instead of the ground.
      data[i * 4 + 2] = clampByte(
        noise(x * 0.012, y * 0.012) * 0.7 + noise(x * 0.035, y * 0.035) * 0.3);
      data[i * 4 + 3] = 255;
    }
  }
  return {
    width,
    height,
    extentXHalfFeet: board.widthHalfFeet,
    extentYHalfFeet: board.heightHalfFeet,
    heights: ground,
    data,
  };
}

/**
 * Gives the ground its shape: three scales of undulation, and the ruts.
 *
 * <p>Three, because ground varies at every scale at once and picking one gives
 * you either a rolling desert with no texture or a gravel pit with no
 * landscape. Long and low is the lie of the land, middling is where the ground
 * gathers and drains, and short is the unevenness underfoot.
 *
 * <p>All three are deliberately gentle. The rules make a space difficult at
 * twenty degrees, so anything below that is free — and there is no reason to
 * spend a movement penalty on decoration.
 */
function shapeGround(
  ground: Float32Array,
  wear: Float32Array,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      // Amplitudes in half-feet, pushed as far as the rules allow and no
      // further: the tests measure the worst slope over a five-foot span and
      // hold it under twenty degrees, which is where ground stops being free.
      const rolling = (noise(x * 0.009, y * 0.009) - 0.5) * 7.0;
      const middling = (noise(x * 0.042, y * 0.042) - 0.5) * 1.8;
      const underfoot = (noise(x * 0.17, y * 0.17) - 0.5) * 0.35;
      // Worn ground is worn *down*. The road is the low line through the
      // country because that is what a century of wheels does, and a road that
      // sits level with the verge beside it reads as a stripe of paint.
      const sunk = wear[at] * wear[at] * RUT_DEPTH;
      ground[at] += rolling + middling + underfoot - sunk;
    }
  }
}

/** How high the ground is at a point, in half-feet. */
export function heightAt(field: GroundField, xHalfFeet: number, yHalfFeet: number): number {
  const x = Math.max(0, Math.min(field.width - 1,
    Math.floor((xHalfFeet / field.extentXHalfFeet) * field.width)));
  const y = Math.max(0, Math.min(field.height - 1,
    Math.floor((yHalfFeet / field.extentYHalfFeet) * field.height)));
  return field.heights[y * field.width + x];
}

/**
 * Breaks the boundary up so it does not read as a shape somebody drew.
 *
 * <p>Two octaves of value noise pushed into the wear, weighted by how close a
 * point already is to the middle of the transition. Full strength everywhere
 * would speckle the middle of the road and the middle of the meadow, which are
 * the two places that should be uniform; applied only across the boundary, it
 * makes the verge ragged and leaves both ends alone.
 */
function roughen(wear: Float32Array, width: number, height: number): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const w = wear[at];
      // A bell over the transition: zero at 0 and 1, one at a half.
      const edge = 4 * w * (1 - w);
      const n = noise(x * 0.09, y * 0.09) * 0.65 + noise(x * 0.31, y * 0.31) * 0.35;
      wear[at] = Math.max(0, Math.min(1, w + (n - 0.5) * 0.55 * edge));
    }
  }
}

/** A three-tap box blur in both directions, in place. */
function smear(field: Float32Array, width: number, height: number): void {
  const scratch = new Float32Array(field.length);
  pass(field, scratch, width, height, 1, 0);
  pass(scratch, field, width, height, 0, 1);
}

function pass(
  from: Float32Array,
  into: Float32Array,
  width: number,
  height: number,
  stepX: number,
  stepY: number,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let total = 0;
      for (let step = -BLUR_RADIUS; step <= BLUR_RADIUS; step++) {
        const sx = Math.max(0, Math.min(width - 1, x + step * stepX));
        const sy = Math.max(0, Math.min(height - 1, y + step * stepY));
        total += from[sy * width + sx];
      }
      into[y * width + x] = total / (BLUR_RADIUS * 2 + 1);
    }
  }
}

/**
 * Value noise, smoothly interpolated, in 0..1.
 *
 * <p>Deterministic from the coordinate rather than random, so the same board is
 * worn the same way every time it is drawn — a verge that reshuffled on every
 * render would be a distraction and a bug report.
 */
export function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ax = fx * fx * (3 - 2 * fx);
  const ay = fy * fy * (3 - 2 * fy);
  const top = lerp(hash(ix, iy), hash(ix + 1, iy), ax);
  const bottom = lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), ax);
  return lerp(top, bottom, ay);
}

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function texel(halfFeet: number, extent: number, size: number): number {
  return Math.max(0, Math.min(size, Math.round((halfFeet / extent) * size)));
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/** The wear and wet at a point, for a test. Mirrors what the shader samples. */
export function groundAt(field: GroundField, xHalfFeet: number, yHalfFeet: number):
    { wear: number; wet: number } {
  const x = Math.max(0, Math.min(field.width - 1,
    Math.floor((xHalfFeet / field.extentXHalfFeet) * field.width)));
  const y = Math.max(0, Math.min(field.height - 1,
    Math.floor((yHalfFeet / field.extentYHalfFeet) * field.height)));
  const at = (y * field.width + x) * 4;
  return { wear: field.data[at] / 255, wet: field.data[at + 1] / 255 };
}
