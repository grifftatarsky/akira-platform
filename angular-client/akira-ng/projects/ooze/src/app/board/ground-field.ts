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

/** Extra smoothing for the elevation alone, to lose the cell staircase. */
const TERRACE_PASSES = 6;

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
  // <b>And the elevation gets far more.</b> A map stores height per five-foot
  // cell as a whole number of feet, so the raw field is a staircase with
  // two-half-foot risers thirty texels apart. On level ground that is invisible
  // — the risers are inches and the ground is flat anyway. On a cliff it is
  // *terracing*: regular steps running along the face, which through a
  // separable blur come out as a plaid, and which read as brown corduroy up
  // every mountain on the board.
  //
  // <p>The blur has to reach across a whole cell to remove them, and the shared
  // pass above is tuned for the verge of a road, which is a much shorter
  // distance. Six more passes on the elevation alone is about a cell and a half
  // of reach — enough to lose the steps and nowhere near enough to lose a
  // hillside, which is a hundred times wider.
  for (let i = 0; i < TERRACE_PASSES; i++) {
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
  // How level the ground already is, before any of this is added. The base at
  // this point is the map's own elevation, smeared — so this is the shape of
  // the country and not of the texture on it.
  const level = levelness(ground, width, height, per);

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
      //
      // <p><b>And by how level it is</b>, which was not obvious until there was
      // a mountain on the board. Every one of these features is a mark that
      // traffic left, and traffic does not go up a cliff — so on the first pass
      // through the mountains the rock walls came out ribbed with cart ruts and
      // stamped with hoofprints, which read as brown corduroy and took three
      // wrong diagnoses to find. Bare rock is bare; only bare *ground* is
      // worked.
      const bare = wear[at] * level[at];
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
 * How level each texel is, from 1 on the flat to 0 on a cliff.
 *
 * <p>Measured off the map's own elevation before any relief is added, and used
 * to decide where the marks of traffic belong. See the note in
 * {@link shapeGround}.
 */
function levelness(
  ground: Float32Array,
  width: number,
  height: number,
  per: number,
): Float32Array {
  const level = new Float32Array(ground.length);
  const step = Math.max(1, Math.round(per));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const east = Math.min(width - 1, x + step);
      const west = Math.max(0, x - step);
      const north = Math.min(height - 1, y + step);
      const south = Math.max(0, y - step);
      const dx = ground[y * width + east] - ground[y * width + west];
      const dy = ground[north * width + x] - ground[south * width + x];
      // Rise over run in half-feet, against a run of two steps.
      const slope = Math.hypot(dx, dy) / ((2 * step) / per);
      // Wholly level under a one-in-five, gone by a one-in-two.
      level[at] = Math.max(0, Math.min(1, 1 - (slope - 0.2) / 0.3));
    }
  }
  return level;
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

/**
 * How high the ground is at a point, in half-feet.
 *
 * <p><b>Interpolated, not nearest.</b> This looks like a detail and is not. The
 * field holds three samples to the half-foot and the mesh has two vertices to
 * it, so nearest-neighbour lookup makes consecutive vertices land on the same
 * texel in an irregular beat — which on level ground is a step of an inch that
 * nobody will ever see, and on a forty-degree wall is a staircase. The first
 * mountain drawn on this board came out as brown corduroy, and this was why.
 */
export function heightAt(field: GroundField, xHalfFeet: number, yHalfFeet: number): number {
  const gx = Math.max(0, Math.min(field.width - 1.001,
    (xHalfFeet / field.extentXHalfFeet) * field.width));
  const gy = Math.max(0, Math.min(field.height - 1.001,
    (yHalfFeet / field.extentYHalfFeet) * field.height));
  const x = Math.floor(gx);
  const y = Math.floor(gy);
  const fx = gx - x;
  const fy = gy - y;
  const at = y * field.width + x;
  const a = field.heights[at];
  const b = field.heights[at + 1];
  const c = field.heights[at + field.width];
  const d = field.heights[at + field.width + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
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
 * How steep the ground is at a point, as rise over run.
 *
 * <p>Sampled a half-foot either way, which is the scale a plant cares about:
 * a hillside is climbable and the face of a boulder on it is not, and the
 * difference between them does not show up over a five-foot square.
 */
export function slopeAt(field: GroundField, xHalfFeet: number, yHalfFeet: number): number {
  const step = 1;
  const dx = heightAt(field, xHalfFeet + step, yHalfFeet)
    - heightAt(field, xHalfFeet - step, yHalfFeet);
  const dy = heightAt(field, xHalfFeet, yHalfFeet + step)
    - heightAt(field, xHalfFeet, yHalfFeet - step);
  return Math.hypot(dx, dy) / (2 * step);
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
/**
 * Blurs a field in place, separably.
 *
 * <p><b>The scratch buffer is kept.</b> `smear` runs twenty-one times building
 * one board — four passes over three fields, six more over the elevation, three
 * inside the puddle test — and it used to allocate a fresh copy of the whole
 * field each time. On the road board that is a hundred megabytes of garbage to
 * blur a picture that is five.
 */
let scratchpad: Float32Array = new Float32Array(0);

function smear(field: Float32Array, width: number, height: number): void {
  if (scratchpad.length < field.length) {
    scratchpad = new Float32Array(field.length);
  }
  pass(field, scratchpad, width, height, false);
  pass(scratchpad, field, width, height, true);
}

/**
 * One axis of a box blur, in a single pass over the data.
 *
 * <p><b>A running sum, not a kernel.</b> The obvious way reads every texel in
 * the window for every texel of output — thirteen reads and thirteen clamps
 * each, so the cost carries the radius with it. A box blur does not need that:
 * moving the window one step adds one value and drops one, whatever its width,
 * which makes the pass O(n) instead of O(n·radius) and leaves the radius free.
 *
 * <p>Together with the buffer above this took building the road board's ground
 * field from 1323 ms to a fraction of it — a number nobody had looked at,
 * because the board only ever reported how long the *mesh* took, and the mesh
 * was 19 ms of it.
 *
 * <p>The sum is a JavaScript number rather than a float, deliberately: a
 * running total over a thousand texels in single precision drifts, and drift
 * in an elevation field is a slope that should not be there.
 */
function pass(
  from: Float32Array,
  into: Float32Array,
  width: number,
  height: number,
  down: boolean,
): void {
  const lines = down ? width : height;
  const count = down ? height : width;
  const stride = down ? width : 1;
  const jump = down ? 1 : width;
  const span = BLUR_RADIUS * 2 + 1;
  const last = count - 1;

  for (let line = 0; line < lines; line++) {
    const base = line * jump;

    // The window at the first texel, with everything off the near end clamped
    // to the first value — which is what the per-tap clamp used to do.
    let total = from[base] * (BLUR_RADIUS + 1);
    for (let i = 1; i <= BLUR_RADIUS; i++) {
      total += from[base + Math.min(i, last) * stride];
    }
    into[base] = total / span;

    for (let at = 1; at < count; at++) {
      const arriving = from[base + Math.min(at + BLUR_RADIUS, last) * stride];
      const leaving = from[base + Math.max(at - BLUR_RADIUS - 1, 0) * stride];
      total += arriving - leaving;
      into[base + at * stride] = total / span;
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

/**
 * A hash of two integers, as a fraction.
 *
 * <p><b>Integer arithmetic, not a sine.</b> The usual one-liner is
 * `fract(sin(dot(p, k)) * 43758.5)`, and it is wrong twice over here.
 *
 * <p>It is slow: `shapeGround` samples {@link noise} seven times per texel and
 * each sample reads four corners, so a 1320 by 900 field is thirty-three
 * million calls to `Math.sin`. That was most of the second this board spent
 * building its ground.
 *
 * <p>And it is a poor hash. A sine is a smooth function being asked to look
 * random, and at large coordinates — which is where every one of these lands —
 * it bands, because neighbouring inputs land on the same part of the curve.
 * The meadow's own placement hash was moved off sines earlier for exactly that
 * reason; this is the same lesson in the file next door.
 */
function hash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 8) / 16777216;
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
