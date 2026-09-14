import { BoardScene } from './board.models';
import { GroundField, groundAt, groundField } from './ground-field';

/**
 * The things lying on the ground.
 *
 * <p>A road is not a texture, it is a place with stuff on it. Loose stones
 * kicked out of the ruts, tufts the wheels have missed, dead branches blown
 * into the verge — and until they are there, even measured ground reads as a
 * printed surface, because nothing on a real one is perfectly smooth for a
 * hundred feet in every direction.
 *
 * <p><b>Placed from the wear field, not sprinkled evenly.</b> Where a thing
 * ends up is a consequence of what the ground is doing: stones surface where
 * the wheels have stripped the turf, branches collect at the verge. So the same
 * field that decides which material to draw decides what is lying on it, and
 * the scatter cannot disagree with the ground it is scattered on.
 *
 * <p><b>No grass here, and that was the lesson.</b> Grass was a photogrammetry
 * scan — eight thousand triangles, its own lighting baked in, authored to be
 * looked at from eye level — and from sixty feet up a few hundred of them read
 * as dark smudges on a green field. No triangle budget fixes that; it is the
 * wrong class of asset for this camera. Grass is the *ground* now: a texture on
 * a mesh with real shape in it, which catches the light the way the water does.
 *
 * <p>Pure and deterministic, like the fields either side of it. The same board
 * scatters identically every time it is drawn: a meadow that reshuffled on
 * every render would be a distraction, and it would make every screenshot of a
 * bug un-reproducible.
 */

/** What kind of thing is lying there. */
export type ScatterKind = 'STONE' | 'BRANCH';

export interface Scattered {
  readonly kind: ScatterKind;
  /** Centre, in half-feet. */
  readonly x: number;
  readonly y: number;
  /** Radians about the vertical. */
  readonly turn: number;
  /** Multiplied onto the model's natural size. */
  readonly scale: number;
}

/**
 * How likely each thing is at a given wear, and how big it comes.
 *
 * @param at wear where this thing is most at home — 0 lush, 1 bare
 * @param spread how far either side of that it still appears
 * @param per how many per hundred square half-feet at its best
 */
const HABIT: Record<ScatterKind, {
  at: number; spread: number; per: number; small: number; large: number;
}> = {
  // Stones are what is left when the turf goes, so they are
  // commonest on bare ground and absent under thick grass.
  STONE: { at: 1.0, spread: 0.55, per: 0.35, small: 0.6, large: 1.6 },
  // Blown into the verge and left there. Neither the road nor the meadow —
  // the edge, which is where things collect.
  BRANCH: { at: 0.55, spread: 0.22, per: 0.06, small: 0.35, large: 0.65 },
};

/**
 * Half-feet between candidate positions, and the density budget behind it.
 *
 * <p><b>These are photogrammetry scans</b> — eight to seventeen thousand
 * triangles for a tuft of grass or a fist-sized stone — so the count is set by
 * what a frame can carry, not by what looks lush. A few hundred objects is two
 * or three million triangles, and everything on this board is drawn three
 * times over: once for the picture, once for the sun's shadow map and once for
 * the occlusion pass.
 *
 * <p>Which turns out to be the right answer anyway. The ground texture is the
 * meadow; scatter is the things standing *on* it, and a real verge has clumps
 * and gaps rather than uniform cover.
 */
const STRIDE = 7;

/**
 * Everything lying on a board.
 *
 * <p>Walks a lattice of candidate spots and keeps some of them, rather than
 * scattering points at random and testing each: a lattice with a per-spot
 * jitter covers the ground evenly without the clumps and bald patches that
 * uniform random sampling always produces, and it costs one hash per spot.
 */
export function scatter(board: BoardScene, field?: GroundField): Scattered[] {
  const ground = field ?? groundField(board);
  const out: Scattered[] = [];
  const kinds = Object.keys(HABIT) as ScatterKind[];

  for (let y = STRIDE / 2; y < board.heightHalfFeet; y += STRIDE) {
    for (let x = STRIDE / 2; x < board.widthHalfFeet; x += STRIDE) {
      // Jittered off the lattice, or the result is a grid of tufts — which is
      // precisely the thing all of this exists to avoid.
      const jx = x + (hash(x, y, 11) - 0.5) * STRIDE;
      const jy = y + (hash(x, y, 23) - 0.5) * STRIDE;
      const { wear, wet } = groundAt(ground, jx, jy);

      for (const kind of kinds) {
        const habit = HABIT[kind];
        // How well this spot suits this thing: one at its ideal wear, nothing
        // beyond its spread, smooth in between.
        const fit = 1 - Math.min(1, Math.abs(wear - habit.at) / habit.spread);
        if (fit <= 0) {
          continue;
        }
        // Nothing takes root in standing mud.
        const chance = fit * fit * habit.per * (STRIDE * STRIDE) / 100 * (1 - wet);
        if (hash(jx, jy, kindSeed(kind)) > chance) {
          continue;
        }
        out.push({
          kind,
          x: jx,
          y: jy,
          turn: hash(jx, jy, 71) * Math.PI * 2,
          scale: habit.small + hash(jx, jy, 97) * (habit.large - habit.small),
        });
      }
    }
  }
  return out;
}

function kindSeed(kind: ScatterKind): number {
  return kind === 'STONE' ? 47 : 59;
}

/** Deterministic 0..1 from a position and a salt. */
function hash(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
