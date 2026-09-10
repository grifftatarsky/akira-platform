import {
  AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points, PointsMaterial,
} from 'three';

/**
 * Dust, hanging in the air.
 *
 * <p>The reference has motes drifting in its light shafts, and shafts are not
 * something this board can have — there is no sky to come through and no
 * volumetric pass to carry them. What it can have is the half that actually
 * reads: specks that are only visible where there is light to catch them.
 *
 * <p>Which is why the material takes the board's light field like everything
 * else. A mote over the torchlit hall glints, the same mote over the crypt is
 * gone, and nobody had to decide where a shaft falls — the lighting already
 * knows. Additive, so a mote adds a little light rather than occluding what is
 * behind it, and depth-tested, so the ones inside a wall stay inside it.
 *
 * <p>Deliberately sparse, and deliberately faint at board scale. Dust is
 * atmosphere at a glance and snow at twice the density, and a tactical board
 * that appears to be snowing is worse than one with no atmosphere at all — the
 * top-down view is the one being *played* on, and flecks over the play surface
 * are noise. Sized in world units, so it stays a speck when the whole level is
 * in frame and becomes air when somebody leans into a room.
 */

/** Motes per hundred square half-feet of board. */
const DENSITY = 0.55;

/** How high they drift, in half-feet. Head height, not ceiling height. */
const CEILING = 24;

/** How far a mote wanders from where it started, in half-feet. */
const WANDER = 3;

export class Motes {

  readonly points: Points;

  private readonly home: Float32Array;
  private readonly seeds: Float32Array;
  private readonly live: Float32BufferAttribute;

  constructor(widthHalfFeet: number, heightHalfFeet: number, density = 1) {
    // Scaled by the theme, because how much dust hangs in the air is a fact
    // about the place. A cellar is full of it; a meadow at noon has a little
    // pollen, and at the cellar's density white specks over lit grass read as
    // dirt on the lens.
    const count = Math.max(0, Math.min(900,
      Math.round((widthHalfFeet * heightHalfFeet) / 100 * DENSITY * density)));

    this.home = new Float32Array(count * 3);
    this.seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.home[i * 3] = Math.random() * widthHalfFeet;
      this.home[i * 3 + 1] = Math.random() * heightHalfFeet;
      // Not from the floor up: dust that all starts on the ground reads as a
      // spawn rather than as air. Two feet to head height, evenly.
      this.home[i * 3 + 2] = 4 + Math.random() * (CEILING - 4);
      this.seeds[i] = Math.random() * 100;
    }

    const geometry = new BufferGeometry();
    this.live = new Float32BufferAttribute(this.home.slice(), 3);
    this.live.setUsage(35048 /* DynamicDrawUsage */);
    geometry.setAttribute('position', this.live);

    this.points = new Points(geometry, new PointsMaterial({
      size: 1.5,
      // In world units, so a mote is dust when the camera is close and a speck
      // when it is not — rather than a constant blob that grows into confetti
      // as you zoom out.
      sizeAttenuation: true,
      // No texture. The renderer rounds these off in the shader instead — a
      // point is a square unless something gives it a shape, and a canvas
      // texture turned out to be an unreliable way to give it one.
      color: 0xffeccd,
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      // Tested against the scene so a mote behind a wall is behind it, but not
      // written, so a hundred of them do not occlude each other.
      depthWrite: false,
    }));
    this.points.frustumCulled = false;
  }

  /** The material, so the renderer can make it answer to the board's light. */
  material(): PointsMaterial {
    return this.points.material as PointsMaterial;
  }

  /**
   * Moves them.
   *
   * <p>Three slow sines at unrelated frequencies, per mote, seeded so no two
   * agree. Not a rise: dust that rises is smoke, and this should read as air
   * being disturbed rather than as anything going anywhere.
   *
   * <p>In script rather than in the vertex shader, which would be cheaper and
   * would fight the light lookup — that reads the world position from
   * `transformed` right after `begin_vertex`, so a mote moved in the shader
   * would be lit at the position it was standing still at.
   */
  step(seconds: number): void {
    const out = this.live.array as Float32Array;
    for (let i = 0; i < this.seeds.length; i++) {
      const seed = this.seeds[i];
      const at = i * 3;
      out[at] = this.home[at] + Math.sin(seconds * 0.21 + seed * 13) * WANDER;
      out[at + 1] = this.home[at + 1] + Math.sin(seconds * 0.17 + seed * 7) * WANDER;
      out[at + 2] = this.home[at + 2] + Math.sin(seconds * 0.13 + seed * 23) * WANDER;
    }
    this.live.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material().map?.dispose();
    this.material().dispose();
  }
}
