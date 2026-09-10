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

/**
 * Texels per half-foot. Thirty across a five-foot square: this is what you see.
 *
 * <p><b>Everything measured in texels has to be derived from this, never
 * written as a texel count.</b> Raising it is the obvious way to get finer
 * ground and the obvious way to silently rescale the whole landscape with it:
 * a noise frequency written per texel makes hills twice as wide when the field
 * doubles in resolution, and a blur written in texels smears half as far. Every
 * such number below is expressed in half-feet and converted here, so this can
 * be turned up for detail without redesigning the country.
 */
export const GROUND_TEXELS_PER_HALF_FOOT = 3;

/** How far wear bleeds sideways, in half-feet either way, per pass. */
const BLUR_HALF_FEET = 1.875;
const BLUR_RADIUS = Math.max(1, Math.round(BLUR_HALF_FEET * GROUND_TEXELS_PER_HALF_FOOT));
const BLUR_PASSES = 4;

/**
 * The width between a cart's wheels, in half-feet.
 *
 * <p>An English wagon of the period ran about five feet between the wheel
 * centres, and every wagon on the road ran the same, which is the whole reason
 * a track has ruts rather than a general hollow: a hundred carts put their
 * wheels in the same two lines.
 */
const AXLE = 10;

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
  puddle(wet, ground, wear, width, height);

  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      data[i * 4] = clampByte(wear[i]);
      data[i * 4 + 1] = clampByte(wet[i]);
      // Two slow octaves, tens of feet across. Real ground is not one color:
      // it is drier on the rises and ranker in the hollows, and without
      // something at that scale a perfectly good scanned texture repeats
      // visibly and the eye reads the repeat instead of the ground.
      const mx = x / GROUND_TEXELS_PER_HALF_FOOT;
      const my = y / GROUND_TEXELS_PER_HALF_FOOT;
      data[i * 4 + 2] = clampByte(
        noise(mx * 0.0192, my * 0.0192) * 0.7 + noise(mx * 0.056, my * 0.056) * 0.3);
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
  const track = cartTrack(wear, width, height);
  const per = GROUND_TEXELS_PER_HALF_FOOT;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      // Sampled in half-feet, not in texels. See GROUND_TEXELS_PER_HALF_FOOT:
      // a frequency written against the texel grid changes what it means the
      // moment that grid changes.
      const hx = x / per;
      const hy = y / per;

      // Amplitudes in half-feet, pushed as far as the rules allow and no
      // further: the tests measure the worst slope over a five-foot span and
      // hold it under twenty degrees, which is where ground stops being free.
      const rolling = (noise(hx * 0.0144, hy * 0.0144) - 0.5) * 7.0;
      const middling = (noise(hx * 0.0672, hy * 0.0672) - 0.5) * 1.8;
      const underfoot = (noise(hx * 0.272, hy * 0.272) - 0.5) * 0.35;

      // Bare ground is lumpy in a way turf is not. Grass mats over everything
      // beneath it and reads smooth from any distance; a road that has been
      // driven on has clods, ridges thrown up between the wheel tracks, and
      // hollows where water sat. All of it scaled by how bare the ground is,
      // so it stops at the verge without anything having to say where that is.
      const bare = wear[at];
      const clods = (noise(hx * 0.544, hy * 0.544) - 0.5) * 0.75 * bare;
      const ridges = (noise(hx * 0.176, hy * 0.992) - 0.5) * 0.55 * bare;
      // Hollows only: the peaks of this noise are cut off, so the road is
      // pitted rather than merely wavy, which is what standing water leaves.
      const hollows = -Math.max(0, noise(hx * 0.128, hy * 0.128) - 0.58) * 3.2 * bare;

      // Hoof and boot prints: sharp little pits about a hand across, cut into
      // the surface rather than added to it. Made by subtracting only the
      // peaks of a high-frequency noise, because a print is a hole and the
      // ground between prints is not a bump.
      const prints = -Math.max(0, noise(hx * 1.6, hy * 1.6) - 0.55) * 0.9 * bare;

      // Worn ground is worn *down*. The road is the low line through the
      // country because that is what a century of wheels does, and a road that
      // sits level with the verge beside it reads as a stripe of paint.
      const sunk = bare * bare * RUT_DEPTH;

      ground[at] += rolling + middling + underfoot
        + clods + ridges + hollows + prints - sunk
        - rutAt(track, x, y, width, per) * bare;
    }
  }
}

/**
 * Where the wheels go: one line down the road, per column.
 *
 * <p>Derived from the wear rather than from the map, so it needs nothing the
 * level has to declare and cannot drift out of step with the road it is a
 * track in. The road is a band of bare ground; the centre of that band, column
 * by column, is where a driver aims.
 *
 * <p>Smoothed hard afterwards. A centroid taken column by column jitters by a
 * texel or two wherever the verge is ragged, and a cart rut that jitters is a
 * sawtooth rather than a track — nothing that carries a wheel wanders faster
 * than the vehicle can steer.
 */
function cartTrack(wear: Float32Array, width: number, height: number): Float32Array {
  const centre = new Float32Array(width);
  const spread = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let weight = 0;
    let sum = 0;
    for (let y = 0; y < height; y++) {
      const w = wear[y * width + x];
      weight += w;
      sum += y * w;
    }
    centre[x] = weight > 0 ? sum / weight : height / 2;
    // Half the worn width, which is how far a rut may sit from the middle
    // before it is off the road and in the grass.
    spread[x] = weight / 2;
  }
  // A wide running mean. Wide because the thing being smoothed is a vehicle's
  // path, not a surface.
  const smoothed = new Float32Array(width * 2);
  const reach = Math.max(4, Math.round(width / 24));
  for (let x = 0; x < width; x++) {
    let c = 0;
    let s = 0;
    let n = 0;
    for (let step = -reach; step <= reach; step++) {
      const at = Math.max(0, Math.min(width - 1, x + step));
      c += centre[at];
      s += spread[at];
      n++;
    }
    smoothed[x * 2] = c / n;
    smoothed[x * 2 + 1] = s / n;
  }
  return smoothed;
}

/**
 * How deep the wheel ruts cut at a texel, in half-feet.
 *
 * <p>Two lines an axle apart either side of the track's centre, weaving a
 * little the way a road does, each one a narrow trough. Faded out where the
 * road is too narrow to hold them — a cart on a footpath is not a cart track.
 */
function rutAt(
  track: Float32Array,
  x: number,
  y: number,
  width: number,
  per: number,
): number {
  const centre = track[x * 2];
  const spread = track[x * 2 + 1];
  if (spread < AXLE * per * 0.55) {
    return 0;
  }
  // The pair as a whole weaves down the road over tens of feet, and the two
  // wheels stay exactly an axle apart while it does.
  const weave = (noise(x / per * 0.02, 40) - 0.5) * 3 * per;
  const half = (AXLE / 2) * per;
  const from = Math.min(
    Math.abs(y - (centre + weave - half)),
    Math.abs(y - (centre + weave + half)));
  // A trough about a foot across and four inches deep. Deep enough that the
  // sun finds a wall of it at any hour but noon — which was the whole problem
  // with the first attempt, at half this depth: the ruts were there, the test
  // could measure them, and at one in the afternoon there was nothing for the
  // light to catch. Still shallow enough that stepping across one is not a
  // slope the rules would charge for, which the tests hold.
  const across = from / (1.1 * per);
  return Math.exp(-across * across) * 0.8;
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
 * Wets the low places.
 *
 * <p>Where a road is muddy is not a fact about the map; it is a fact about the
 * shape. Water runs downhill, sits in the wheel ruts and the hollows, and
 * stands there for days on ground that has been driven into a clay pan — which
 * is why a cart track is dark in two lines and pale between them, and why the
 * hoofprints beside it are little dark coins. The height field already knows
 * all of that, so the wetness is read off it rather than painted.
 *
 * <p>Measured against a blurred copy of the ground rather than against a
 * level, because "low" has to mean low *compared to here*. Against an absolute
 * height the whole far end of the board would be a swamp for no reason but
 * that the country slopes.
 *
 * <p>Only on bare ground: turf drinks, and a meadow with standing water in it
 * is a meadow after a storm rather than a meadow in July.
 */
function puddle(
  wet: Float32Array,
  ground: Float32Array,
  wear: Float32Array,
  width: number,
  height: number,
): void {
  const level = Float32Array.from(ground);
  for (let i = 0; i < 3; i++) {
    smear(level, width, height);
  }
  for (let i = 0; i < wet.length; i++) {
    // A threshold, not a ramp from zero. Ground *slightly* below its
    // surroundings is most of the road — the whole surface sits a little under
    // the verge beside it — and a ramp made the entire track uniformly damp,
    // which reads as a dark stripe of paint and hides the very ruts it was
    // added to fill. Three inches down is where water stops running off.
    const below = level[i] - ground[i];
    const held = below <= 0.12 ? 0
      : below >= 0.6 ? 1
      : (below - 0.12) / 0.48;
    wet[i] = Math.max(wet[i], held * wear[i]);
  }
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
      const hx = x / GROUND_TEXELS_PER_HALF_FOOT;
      const hy = y / GROUND_TEXELS_PER_HALF_FOOT;
      const n = noise(hx * 0.144, hy * 0.144) * 0.65 + noise(hx * 0.496, hy * 0.496) * 0.35;
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
