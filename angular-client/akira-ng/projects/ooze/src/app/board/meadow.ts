import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, Material, Matrix4,
  MeshStandardMaterial, PerspectiveCamera, Quaternion, Vector2, Vector3,
} from 'three';
import { BoardScene } from './board.models';
import { GroundField, groundAt, heightAt, noise, slopeAt } from './ground-field';
import { MESH_DETAIL } from './ground-splat';

/**
 * The things growing out of the ground.
 *
 * <p>The step a texture cannot take. However good a photograph of a meadow is,
 * it is a picture painted onto a surface: it has no silhouette, nothing stands
 * above anything else, and nothing moves. Plants are geometry — they break the
 * ground's outline, they shade one another, and they answer to the wind.
 *
 * <p><b>Five species, not one grass.</b> A field of one plant is a lawn, and a
 * lawn is what a single blade shape repeated a quarter of a million times looks
 * like however well it is randomised. Real ground in July is a mixture that
 * varies by the yard: rank grass where nothing walks, seed heads standing over
 * it, clover matting the gaps, plantain flattened onto the path itself, and
 * flowers in drifts rather than sprinkled evenly. Each of those is a different
 * shape, a different height and a different color, and having five of them is
 * what makes the ground read as grown rather than as generated.
 *
 * <p><b>Species cluster; they do not mix evenly.</b> Every species carries its
 * own low-frequency field, and a spot goes to whichever species is winning
 * there. A uniform random pick would put one clover in every seven clumps
 * everywhere, which averages out to a texture — the patchiness *is* the
 * biodiversity, not the species list.
 *
 * <p><b>They arch, and that is not decoration.</b> A blade standing straight up
 * is edge-on from directly overhead, and overhead is this board's default
 * camera — vertical blades would cost millions of triangles to be invisible
 * from exactly the angle the game is played at. Real growth bends over under
 * its own weight; bent, a leaf turns its face to a camera above it and its edge
 * to one beside it, which is the right way round.
 *
 * <p>No textures and no alpha anywhere. Every plant is tapered strips of
 * triangles, which costs less than the alpha-cut cards it replaces and brings
 * none of the sorting or the cutout fringing. Color is per-vertex, dark at the
 * root and pale at the tip, times a per-instance tone.
 *
 * <p>That root-to-tip ramp is now carrying more than it used to. The occlusion
 * pass has been told not to look at the meadow — see MEADOW_LAYER in the
 * renderer — so the darkness down among the stems, which the pass used to
 * supply, has to be painted into the plants themselves. It is a cheaper way to
 * get the same reading: the shade at a blade's base is not really a
 * screen-space effect, it is a fact about grass.
 *
 * <p><b>But the pale end has to stay honest.</b> This board's default camera
 * looks straight down, and from straight down a meadow is nothing *but* tips —
 * so a tip colour chosen to look good on a blade seen edge-on becomes the
 * colour of the whole field seen from above. It showed up the moment the
 * density went to three: the same ramp that read as sunlit grass at one
 * plant per spot read as a dried-out cream field at three, because there were
 * three times as many tips and no more roots. The tips are green now, and
 * only the flowers are allowed to be pale.
 */

/**
 * Half-feet between candidate plants, before jitter.
 *
 * <p>Two spacings, because the two modes cost very different amounts per plant.
 * A clump of grass is thirty triangles and a clover head sixty; with the
 * mixture off, the same triangle budget buys about twice as many plants, and a
 * meadow of nothing but grass needs them — the other species were part of what
 * filled the gaps, and grass alone at the mixed spacing reads as a thin lawn.
 */
const MIXED_STRIDE = 0.6;
const GRASS_STRIDE = 0.42;

/**
 * How far a root is pushed under the ground, in half-feet.
 *
 * <p>Sinking a root is invisible; floating one is a plant hovering over a
 * field, which is what happens at every hoofprint if the height is taken from
 * the field rather than from the surface the mesh actually interpolates.
 */
const ROOT_SINK = 0.06;

/**
 * The sun, as the meadow needs to know it.
 *
 * <p>Not for lighting — three does that. For *transmission*, which three does
 * not: a blade of grass is thin enough to let light through it, and needs to
 * know where the light is coming from and how strong it is to work out how much
 * comes out the other side.
 */
export interface SunUniforms {
  /** Which way the light travels, in world space. */
  readonly direction: { value: Vector3 };
  /** Its colour times its strength. */
  readonly glow: { value: Color };
}

/** One strip of a plant: a tapered, arching ribbon from the root outward. */
export interface Strip {
  /** Where on the clump it is rooted, in half-feet from the middle. */
  rootX: number;
  rootY: number;
  /** Which way it leans. */
  yaw: number;
  /** How tall, before the instance's own scale. */
  tall: number;
  /** How far it leans out by the tip, as a fraction of its height. */
  bend: number;
  /**
   * How far it reaches out, absolutely, instead of as a fraction of its height.
   *
   * <p>For anything whose length is mostly horizontal. A drooping conifer
   * branch rises an inch and reaches three feet, and expressing that as a
   * multiple of its rise means a bend of thirty-six — a number that says
   * nothing and breaks the moment the rise is tuned.
   */
  reach?: number;
  /** Half-width at the root. */
  width: number;
  /** How much of the width survives to the tip. */
  taper: number;
  /**
   * Shapes it as a leaf rather than a tapering ribbon.
   *
   * <p>A linear taper can only make a wedge, and a wedge is what made the
   * clover look like flat cabbage: a leaflet an inch long, wider than it is
   * long, holding almost its full width to a squared-off tip, is a green
   * rectangle from every angle. A leaf is none of those things — it is narrow
   * where it joins the stalk, widest somewhere along its length, and closed to
   * a point at the end.
   *
   * <p>The number says where the widest part falls: the width follows
   * sin(pi * t^leaf), so 0.5 peaks a quarter of the way up (a clover leaflet,
   * round and broad near the base) and 1 peaks halfway (a plantain leaf,
   * lance-shaped). Absent leaves the plain taper, which is what a blade of
   * grass actually is.
   */
  leaf?: number;
  /** Sections along it. Three reads as a curve; one reads as a shard. */
  segments: number;
  root: number;
  tip: number;
  /**
   * A colour partway along, and where along.
   *
   * <p>Because some markings are *bands* and not gradients. The pale crescent
   * across a clover leaf sits about a third of the way from the base and is the
   * single most recognisable thing about the plant; approximated as a
   * root-to-tip ramp it lands in the wrong place and reads as a leaf that
   * happens to be lighter at the end.
   */
  band?: { at: number; color: number };
  /**
   * Cuts a notch into the tip.
   *
   * <p>The other half of what makes a clover leaflet recognisable: the tip is
   * not a point, it is a heart. The last segment's centre is pulled back toward
   * the root by this fraction of the strip's length, which turns the closing
   * point into a dent between two lobes.
   */
  notch?: number;
}

export interface Species {
  readonly name: string;
  /** How much of the meadow it takes where it is winning. */
  readonly share: number;
  /** Repeats per half-foot of its patch field: how big its drifts are. */
  readonly patch: number;
  /** How hard it clusters. Zero would scatter it evenly and defeat the point. */
  readonly clumping: number;
  /**
   * Whether it punctuates the meadow rather than filling it.
   *
   * <p>Grass, clover and plantain are the sward: twice as many of them is a
   * thicker meadow, which is what the density knob is for. Seed heads and
   * flowers are not — a July field has about so many daisies in it, and
   * tripling them along with everything else does not make the meadow denser,
   * it makes it a bed of daisies. Turning the density up did exactly that: the
   * field went from green with a scatter of cream to cream with some green
   * showing through.
   *
   * <p>So a species that punctuates has its share divided by the density,
   * which holds its count roughly fixed while the fill grows around it. Fixed
   * *count*, not fixed fraction — how much of a field reads as flowers is a
   * question about how many flowers there are per acre, and has nothing to do
   * with how many blades of grass are standing between them.
   */
  readonly punctuates: boolean;
  /**
   * How worn the ground may be and still grow it.
   *
   * <p>Not one number for the meadow, because it is not one meadow. Rank grass
   * gives up the moment anything walks on it; plantain is called "the white
   * man's footprint" precisely because it grows *on* the trodden part, and a
   * verge with plantain on it and nothing else is a verge somebody uses.
   */
  readonly tolerates: number;
  /**
   * The steepest ground it will grow on, as rise over run.
   *
   * <p>Nothing much grows on a cliff, and a headland whose hundred-foot face is
   * carpeted in turf reads as a hill with a texture problem rather than as a
   * cliff. One is forty-five degrees, two is sixty-three; a tree wants well
   * under one and lichen would want anything.
   *
   * <p>Absent means it does not care, which is right for a board with no
   * elevation on it and wrong for every board that has any.
   */
  readonly slope?: number;
  readonly scale: readonly [number, number];
  /** How far the wind moves its tips. */
  readonly sway: number;
  /**
   * Whether it casts.
   *
   * <p>Almost nothing does. Running a quarter of a million plants through the
   * shadow pass draws the whole meadow a second time for shadows the size of a
   * blade of grass — and at the resolution a board-wide shadow camera can
   * afford, a blade's shadow is a texel of noise rather than a shape. The
   * occlusion pass already darkens where growth gathers, which is the part
   * that reads.
   *
   * <p>What *is* worth casting is whatever stands clear of the sward. A seed
   * head two feet up throws a shadow a foot long across the grass below it,
   * and that shadow is the only thing that says the head is above the field
   * rather than painted on it. So the seed heads cast and nothing else does.
   *
   * <p>Not the flowers, though they are as tall: a daisy's head is an inch
   * across, so its shadow is a speck at any distance and a texel of noise at
   * the shadow map's resolution, and it was costing a million triangles a
   * frame to be that.
   */
  readonly casts: boolean;
  readonly lush: number;
  readonly dry: number;
  readonly strips: () => Strip[];
}

/** Rank meadow grass: the body of the field. */
function grassStrips(): Strip[] {
  return spread(5, 0.5, (i, yaw, rootX, rootY) => ({
    rootX, rootY, yaw,
    tall: 0.72 + ((i * 7) % 5) * 0.13,
    bend: 0.34 + ((i * 3) % 4) * 0.13,
    width: 0.048, taper: 0.15, segments: 3,
    root: 0x2c3f18, tip: 0x74963a,
  }));
}

/**
 * Grass gone to seed: taller, straighter, with a head on it.
 *
 * <p>The head is four short strips crossed at the tip rather than a texture,
 * for the same reason as everything else here — and it is what actually reads
 * from above, because a seed head is the widest part of the plant and the only
 * part that catches light against the grass below it.
 */
function seedStrips(): Strip[] {
  const stalks = spread(3, 0.35, (i, yaw, rootX, rootY) => ({
    rootX, rootY, yaw,
    tall: 2.5 + ((i * 5) % 3) * 0.35,
    bend: 0.16 + (i % 2) * 0.08,
    width: 0.036, taper: 0.35, segments: 4,
    root: 0x39471e, tip: 0x94974f,
  }));
  const heads = stalks.flatMap(stalk => [0, 1].map(k => ({
    // Rooted where the stalk's tip lands, so the head sits on the stalk rather
    // than beside it: the lean is bend times height, along the stalk's yaw.
    rootX: stalk.rootX + Math.cos(stalk.yaw) * stalk.bend * stalk.tall,
    rootY: stalk.rootY + Math.sin(stalk.yaw) * stalk.bend * stalk.tall,
    yaw: stalk.yaw + k * Math.PI / 2,
    tall: 0.5, bend: 0.1,
    width: 0.07, taper: 0.45, segments: 3,
    root: 0xa39a5f, tip: 0xcabe86,
    lift: stalk.tall,
  } as Strip & { lift: number })));
  return [...stalks, ...heads];
}

/** Plantain: a flat rosette that survives being walked on. */
function broadleafStrips(): Strip[] {
  return spread(6, 0.18, (i, yaw, rootX, rootY) => ({
    rootX, rootY, yaw,
    tall: 0.34 + ((i * 3) % 3) * 0.07,
    // Nearly flat: a rosette pressed to the ground is the shape, and it is why
    // the plant is still there.
    bend: 1.5 + (i % 2) * 0.3,
    width: 0.19, taper: 1, leaf: 0.9, segments: 3,
    root: 0x253c14, tip: 0x6f8f3c,
  }));
}

/**
 * Clover: low three-lobed cover that mats the gaps between the grass.
 *
 * <p><b>Five heads and no stems.</b> It was seven heads on seven stems, and
 * measured rather than guessed it came to 112 triangles a plant — forty per
 * cent of the whole meadow's cost, for something three inches tall that is a
 * green dot from the camera the game is played at. The stems were the waste:
 * a clover leaf at that height sits *on* the ground, so the stalk under it is
 * two triangles nobody can see, seven times over. Trimmed to five heads it is
 * sixty, and it looks the same.
 */
function cloverStrips(): Strip[] {
  return spread(4, 0.45, (i, yaw, rootX, rootY) => {
    // A short petiole's worth of height, implied rather than drawn: the stalk
    // under a three-inch leaf is two triangles nobody can see.
    const lift = 0.14 + ((i * 5) % 3) * 0.06;
    return [0, 1, 2].map(lobe => ({
      rootX, rootY, yaw: yaw + lobe * 2.094,
      // Held up at an angle rather than pressed flat. Clover is a mat, but
      // each trefoil tilts its faces to the light, and flat leaflets give the
      // whole patch one shading value.
      //
      // <p>Wider than it is long, and broad almost from the base: a clover
      // leaflet is a heart, not a spear. Four segments rather than three, so
      // the outline can round instead of turning a corner.
      tall: 0.26, bend: 0.5, width: 0.13, taper: 1, leaf: 0.34, segments: 4,
      // A notched tip and a pale crescent a third of the way up — the two
      // things that make a person say "clover" instead of "leaf". Neither
      // survives as a gradient; both are shapes.
      notch: 0.38,
      band: { at: 0.36, color: 0xa8c46a },
      root: 0x2b4a1a, tip: 0x5d8730, lift,
    } as Strip & { lift: number }));
  }).flat() as Strip[];
}

/** Wildflowers, which grow in drifts and are most of the color in a July field. */
function flowerStrips(): Strip[] {
  return spread(3, 0.3, (i, yaw, rootX, rootY) => {
    const stem = 1.9 + (i % 2) * 0.35;
    return [
      { rootX, rootY, yaw, tall: stem, bend: 0.22, width: 0.022, taper: 0.7,
        segments: 3, root: 0x354b1a, tip: 0x6c8a39 },
      ...[0, 1, 2, 3, 4].map(petal => ({
        rootX, rootY, yaw: yaw + petal * 1.2566,
        tall: 0.22, bend: 1.1, width: 0.085, taper: 1, leaf: 0.7, segments: 2,
        // White, and shifted per instance — the drift is one flower, and two
        // drifts twenty feet apart are usually not the same one.
        root: 0xe8e2cf, tip: 0xfffdf2, lift: stem,
      } as Strip & { lift: number })),
    ];
  }).flat() as Strip[];
}

/**
 * Roots spread round a small disc rather than fanned off one point.
 *
 * <p>Blades radiating from a single origin at even angles make a star, and a
 * meadow of identical stars is a pattern — which is the one thing all of this
 * exists to avoid. The golden angle keeps successive roots from lining up, and
 * the per-strip yaw is stepped by a number with no relation to the count.
 */
function spread<T>(
  count: number,
  radius: number,
  build: (i: number, yaw: number, rootX: number, rootY: number) => T,
): T[] {
  const made: T[] = [];
  for (let i = 0; i < count; i++) {
    const angle = i * 2.3999;
    const r = radius * (0.3 + ((i * 3) % 4) * 0.23);
    made.push(build(i, angle + 0.7, Math.cos(angle * 1.618) * r, Math.sin(angle * 1.618) * r));
  }
  return made;
}

/**
 * The summer meadow: what grows beside a Virginia cart road in July.
 *
 * <p>Exported and named, because it is one planting rather than the definition
 * of planting. A coast wants sea grass on sand, a wood wants ferns and needle
 * litter, a snowfield wants nothing at all — and until this was a list a theme
 * could choose, there could only ever be one kind of ground.
 */
export const MEADOW: readonly Species[] = [
  {
    name: 'grass', punctuates: false, share: 1, patch: 0.035, clumping: 1, tolerates: 0.42,
    scale: [0.7, 1.5], sway: 0.16, casts: false,
    lush: 0x6f8a3a, dry: 0xb0ab5c, strips: grassStrips,
  },
  {
    name: 'seed', punctuates: true, share: 0.55, patch: 0.055, clumping: 3, tolerates: 0.3,
    scale: [0.9, 1.4], sway: 0.26, casts: true,
    lush: 0x93924e, dry: 0xbdb173, strips: seedStrips,
  },
  {
    name: 'clover', punctuates: false, share: 0.95, patch: 0.07, clumping: 2, tolerates: 0.55,
    scale: [0.9, 1.5], sway: 0.015, casts: false,
    lush: 0x6d9c3c, dry: 0x8fae52, strips: cloverStrips,
  },
  {
    name: 'broadleaf', punctuates: false, share: 0.75, patch: 0.09, clumping: 2, tolerates: 0.72,
    scale: [0.8, 1.6], sway: 0.012, casts: false,
    lush: 0x6f9440, dry: 0x93a054, strips: broadleafStrips,
  },
  {
    name: 'flower', punctuates: true, share: 0.4, patch: 0.16, clumping: 4, tolerates: 0.26,
    scale: [0.85, 1.25], sway: 0.3, casts: false,
    lush: 0xefe8d2, dry: 0xd8bf5e, strips: flowerStrips,
  },
];

export interface Meadow {
  readonly meshes: readonly InstancedMesh[];
  /** Individual plants standing on the board, for the readout. */
  readonly plants: number;
  /**
   * What each species costs, measured rather than reasoned about.
   *
   * <p>Exists because the triangle count on screen cannot be attributed by
   * looking at it: five instanced meshes report as one number, the shadow pass
   * adds an unknown fraction of them again, and arithmetic on the species table
   * gets the *distribution* wrong — the roulette weights are each species'
   * share times a random field raised to its own power, which is not a number
   * anybody should be estimating in their head.
   */
  readonly census: readonly { name: string; plants: number; triangles: number }[];
  /**
   * Sets how much of each chunk to draw, for this camera at this size.
   *
   * <p>Called every frame. See {@link PLANTS_PER_PIXEL}.
   */
  detail(camera: PerspectiveCamera, pixelsHigh: number): void;
  dispose(): void;
}

/**
 * One species, as a geometry an {@code InstancedMesh} can draw once.
 *
 * <p>Built once per species and instanced, so the whole meadow is five draw
 * calls and the only per-plant cost is a matrix and a color.
 */
function speciesGeometry(species: Species): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // How far each vertex sits off the middle of its own strip, so the shader can
  // rebuild the centreline and widen about it. See MIN_HALF_PIXELS.
  const sides: number[] = [];
  // How thin the plant is here, from nothing at the root to wholly translucent
  // at the tip. See the transmission term in plantMaterial.
  const thin: number[] = [];
  const root = new Color();
  const tip = new Color();
  const band = new Color();
  const shade = new Color();
  let vertex = 0;

  for (const strip of species.strips()) {
    const cos = Math.cos(strip.yaw);
    const sin = Math.sin(strip.yaw);
    const lift = (strip as Strip & { lift?: number }).lift ?? 0;
    root.setHex(strip.root);
    tip.setHex(strip.tip);
    if (strip.band) {
      band.setHex(strip.band.color);
    }

    for (let i = 0; i <= strip.segments; i++) {
      const t = i / strip.segments;
      const halfWidth = strip.leaf
        ? strip.width * Math.sin(Math.PI * Math.pow(t, strip.leaf))
        : strip.width * (1 - t * (1 - strip.taper));
      // Height eases off as the strip leans over, and the lean grows faster
      // than the height, so the last third is nearly horizontal.
      const up = lift + Math.sin(t * Math.PI * 0.5) * strip.tall;
      // The notch: the last step stops short along the strip while its two
      // edges do not, which leaves a dent between them instead of a point.
      const notched = strip.notch && i === strip.segments ? 1 - strip.notch : 1;
      // Absolute where the strip is mostly horizontal, and a fraction of the
      // rise otherwise. The absolute value matters: a branch with a negative
      // rise droops, and it must still reach *outward* while it does.
      const span = strip.reach ?? strip.bend * Math.abs(strip.tall);
      const out = t * t * span * notched;
      if (strip.band) {
        const at = strip.band.at;
        shade.copy(root).lerp(band, Math.min(1, t / at));
        if (t > at) {
          shade.copy(band).lerp(tip, (t - at) / (1 - at));
        }
      } else {
        shade.copy(root).lerp(tip, t * t);
      }

      for (const side of [-1, 1]) {
        const across = side * halfWidth;
        positions.push(
          strip.rootX + cos * out - sin * across,
          strip.rootY + sin * out + cos * across,
          up,
        );
        sides.push(-sin * across, cos * across, 0);
        thin.push(t);
        colors.push(shade.r, shade.g, shade.b);
        uvs.push((side + 1) / 2, t);
      }
      if (i < strip.segments) {
        indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
      }
      vertex += 2;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute('boardSide', new BufferAttribute(new Float32Array(sides), 3));
  geometry.setAttribute('boardThin', new BufferAttribute(new Float32Array(thin), 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Where the ground mesh actually is under a point.
 *
 * <p>Not {@link heightAt} on its own. The mesh carries a vertex every
 * {@link MESH_DETAIL}th of a half-foot and the hardware interpolates between
 * them, so the surface between two vertices is the straight line, not the
 * field's own value there. Over a hoofprint or a wheel rut the two differ by an
 * inch or two, which is a fifth of a blade — enough to leave a clump standing
 * on air over the very features that were added to be looked at.
 */
function surfaceAt(field: GroundField, x: number, y: number): number {
  const step = 1 / MESH_DETAIL;
  const x0 = Math.floor(x / step) * step;
  const y0 = Math.floor(y / step) * step;
  const fx = (x - x0) / step;
  const fy = (y - y0) / step;
  const a = heightAt(field, x0, y0);
  const b = heightAt(field, x0 + step, y0);
  const c = heightAt(field, x0, y0 + step);
  const d = heightAt(field, x0 + step, y0 + step);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

interface Plant {
  x: number; y: number; z: number;
  turn: number; tilt: number; scale: number; tone: number;
  /** A stable draw, so that any prefix of a sorted bucket is a fair sample. */
  rank: number;
}

/**
 * How wide a chunk of meadow is, in half-feet.
 *
 * <p>The whole reason there are chunks. An instanced mesh is culled as one
 * object, so a single mesh holding the board's grass is either wholly drawn or
 * wholly skipped — and since it always overlaps the view, it is always wholly
 * drawn. Zoomed in on two creatures, the board was submitting eight hundred
 * thousand plants to show about fifteen thousand of them.
 *
 * <p>A hundred half-feet — fifty feet, ten squares — is a compromise between
 * two costs that pull opposite ways. Smaller chunks cull more precisely and
 * cost a draw call each, and a draw call in WebGL is not free: at eighty
 * half-feet the board came to three hundred and eighteen calls a frame, which
 * is a real slice of a sixty-hertz budget spent on submission rather than on
 * anything visible. This is fifteen chunks, so five species come to at most
 * seventy-five calls with the whole board in view — and a small fraction of
 * that as soon as it is not, which is the case the chunking exists for.
 */
const CHUNK = 100;

/**
 * How many plants a pixel is allowed to be worth before they start being left
 * out.
 *
 * <p>The other half of the same idea. Drawing eight hundred thousand plants
 * into a screen that is a million pixels wide is not detail, it is a queue of
 * geometry competing for the same pixel — every one of them shaded, and all but
 * one of them thrown away. So the count drawn is scaled to keep roughly this
 * many plants per pixel, which makes the meadow's cost a function of how big
 * the picture is rather than how big the board is.
 *
 * <p>It works *because* of the widening: a blade dropped at distance leaves a
 * gap, and the blades that remain are already being fattened to hold a pixel,
 * so they close it. Without that this would read as the meadow thinning out.
 */
const PLANTS_PER_PIXEL = 0.7;

/** Never below this fraction, or a distant board becomes bare ground. */
const MIN_DETAIL = 0.25;

/**
 * Half-feet between clump centres.
 *
 * <p><b>Real fields are not random, they are clumpy.</b> That is the sentence
 * from the Ghost of Tsushima grass talk that this whole mechanism exists for,
 * and it is stated there as an art problem rather than a technical one. Every
 * plant here had its own independent height, lean and colour — which is uniform
 * noise, and uniform noise reads as manufactured however finely it is stirred.
 * A real meadow has patches of tall grass, patches of short, patches leaning
 * together because they grew in the same shelter.
 *
 * <p>So the ground is divided into cells by nearest-centre — a Voronoi diagram
 * over a jittered lattice — and the *clump* decides how tall its plants stand,
 * which way they lean and roughly what colour they are. The plant keeps a
 * little of its own on top, or the clump would be a stamp.
 *
 * <p>Three feet across: big enough that a clump holds several plants at any
 * density the slider reaches, small enough that a five-foot square holds more
 * than one.
 */
const CLUMP_SPAN = 6;

/** What a clump imposes on everything growing in it. */
interface Clump {
  /** Multiplies the plant's own height. */
  readonly tall: number;
  /** Which way the whole clump leans, in radians. */
  readonly lean: number;
  /** Where along the species' colour range the clump sits. */
  readonly tone: number;
}

/**
 * The clump a point belongs to.
 *
 * <p>Nearest of nine candidates — the plant's own lattice cell and its eight
 * neighbours — because a point near a cell edge is often closer to the centre
 * next door, and taking its own cell would put the seams of the lattice back
 * into the picture as straight lines.
 */
function clumpAt(x: number, y: number): Clump {
  const gx = Math.floor(x / CLUMP_SPAN);
  const gy = Math.floor(y / CLUMP_SPAN);
  let nearest = Infinity;
  let ix = gx;
  let iy = gy;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i;
      const cy = gy + j;
      seedAt(cx * 977 + 13, cy * 641 + 7);
      const px = (cx + nextRandom()) * CLUMP_SPAN;
      const py = (cy + nextRandom()) * CLUMP_SPAN;
      const away = (px - x) * (px - x) + (py - y) * (py - y);
      if (away < nearest) {
        nearest = away;
        ix = cx;
        iy = cy;
      }
    }
  }
  seedAt(ix * 1013 + 7, iy * 1777 + 3);
  return {
    tall: 0.6 + nextRandom() * 0.8,
    lean: nextRandom() * Math.PI * 2,
    tone: nextRandom(),
  };
}

/**
 * A deterministic stream of random numbers from a position.
 *
 * <p>Nine values were wanted per candidate — two for the jitter, one for the
 * species draw, one for the thinning, and five for turn, tilt, scale, tone and
 * rank — and each was a separate `sin`-based hash. At three times density that
 * is thirteen million transcendental calls to lay out a board, which is most of
 * the pause when one loads. This seeds once per candidate from its position and
 * shifts, which is a handful of integer operations a value.
 *
 * <p>Still deterministic from the coordinate, which is the property that
 * matters: the same board is grown the same way every time it is drawn, and a
 * meadow that reshuffled on every render would be a bug report.
 */
let stream = 1;
function seedAt(x: number, y: number): void {
  stream = (Math.imul(Math.round(x * 128), 0x27d4eb2d)
    ^ Math.imul(Math.round(y * 128) + 0x9e37, 0x165667b1)) >>> 0;
  // A zero state is a fixed point of xorshift and would make a whole row
  // identical.
  stream = stream === 0 ? 0x6d2b79f5 : stream;
}
function nextRandom(): number {
  stream ^= stream << 13;
  stream >>>= 0;
  stream ^= stream >>> 17;
  stream ^= stream << 5;
  stream >>>= 0;
  return stream / 4294967296;
}

/**
 * One species' drift field, sampled once on a coarse lattice.
 *
 * <p>These fields decide where a species clusters and their features are tens
 * of half-feet across; the candidates asking about them are a third of a
 * half-foot apart. Evaluating the noise per candidate was sampling a hill at
 * the resolution of the grass on it — seven and a half million calls for about
 * thirty thousand distinct values. A lattice at a quarter of the field's own
 * period, read back bilinearly, is the same field for a fortieth of the work.
 */
class Drift {

  private readonly values: Float32Array;
  private readonly wide: number;
  private readonly high: number;

  constructor(
    widthHalfFeet: number,
    heightHalfFeet: number,
    private readonly step: number,
    frequency: number,
    salt: number,
  ) {
    this.wide = Math.ceil(widthHalfFeet / step) + 2;
    this.high = Math.ceil(heightHalfFeet / step) + 2;
    this.values = new Float32Array(this.wide * this.high);
    for (let j = 0; j < this.high; j++) {
      for (let i = 0; i < this.wide; i++) {
        this.values[j * this.wide + i] =
          noise(i * step * frequency + salt * 37.3, j * step * frequency + salt * 91.7);
      }
    }
  }

  at(x: number, y: number): number {
    const gx = Math.min(this.wide - 2, Math.max(0, x / this.step));
    const gy = Math.min(this.high - 2, Math.max(0, y / this.step));
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = gx - i;
    const fy = gy - j;
    const at = j * this.wide + i;
    const a = this.values[at];
    const b = this.values[at + 1];
    const c = this.values[at + this.wide];
    const d = this.values[at + this.wide + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
}

/** Everything one call to {@link meadow} needs. */
export interface Sowing {
  readonly board: BoardScene;
  readonly field: GroundField;
  /** Patches a material to answer to the board's light field. */
  readonly light: (material: Material) => Material;
  /** The shared clock uniform, so the wind moves. */
  readonly time: { value: number };
  /** What fraction of candidate spots grow, where the turf is whole. */
  readonly density: number;
  /** The density knob, as a multiple of the planting's own spacing. */
  readonly spread: number;
  readonly viewport: { value: Vector2 };
  readonly wind: { value: number };
  readonly sun: SunUniforms;
  readonly planting: readonly Species[];
  /**
   * Half-feet between candidates, where the planting is not ground cover.
   *
   * <p>Given for a canopy and left out for a meadow. Trees are the same
   * machinery as grass — instanced, chunked, culled, thinned by pixel budget,
   * moved by the same wind and lit through by the same sun — at forty times the
   * scale and a hundredth of the density, and the only thing that has to differ
   * is how far apart the candidates stand.
   */
  readonly spacing?: number;
  /** Whether a meadow grows its whole planting or only the first of it. */
  readonly mixed?: boolean;
}

/** Everything growing on a board. */
export function meadow(sowing: Sowing): Meadow | null {
  const {
    board, field, light, time, density, spread, viewport, wind, sun, planting,
  } = sowing;
  const growing = planting;
  // Plants go up with the *square* of how close together they stand, so the
  // knob is plants-per-area and the spacing is its root. A slider that moved
  // the spacing directly would go from bare to unusable across two notches at
  // one end and do nothing at the other.
  //
  // <p>A canopy passes its own spacing and opts out of the density knob: how
  // many trees stand in a wood is a fact about the wood, and thickening the
  // undergrowth should not plant more of them.
  const stride = sowing.spacing ?? (sowing.mixed ? MIXED_STRIDE : GRASS_STRIDE);
  const spacing = sowing.spacing
    ? stride
    : stride / Math.sqrt(Math.max(0.05, spread));

  const wide = Math.max(1, Math.ceil(board.widthHalfFeet / CHUNK));
  const high = Math.max(1, Math.ceil(board.heightHalfFeet / CHUNK));
  const chunkWide = board.widthHalfFeet / wide;
  const chunkHigh = board.heightHalfFeet / high;
  const chunks = wide * high;

  // A bucket per species per chunk. Sparse in practice — the road has no
  // grass on it — and empty ones never become a mesh.
  const plots: Plant[][] = new Array(growing.length * chunks);
  const weights = new Float64Array(growing.length);
  const drifts = growing.map((species, s) =>
    // A quarter of the field's own period, which is as coarse as bilinear
    // interpolation can be without visibly flattening the crests.
    new Drift(board.widthHalfFeet, board.heightHalfFeet,
      Math.max(1, 0.25 / species.patch), species.patch, s));

  for (let y = spacing / 2; y < board.heightHalfFeet; y += spacing) {
    for (let x = spacing / 2; x < board.widthHalfFeet; x += spacing) {
      seedAt(x, y);
      const jx = x + (nextRandom() - 0.5) * spacing;
      const jy = y + (nextRandom() - 0.5) * spacing;
      const { wear, wet } = groundAt(field, jx, jy);
      if (wet > 0.3) {
        continue;
      }
      const steep = slopeAt(field, jx, jy);

      // Which species grows here — drawn from the local mixture, not won by
      // whichever field happens to be highest.
      //
      // <p>Taking the strongest species outright was the obvious thing and it
      // produced solid mats: every plant inside a flower's drift was a flower,
      // so a meadow that should have had daisies *in* the grass had white
      // sheets laid over it instead. Real drifts are a shift in the odds, not
      // a change of surface — the flowers thicken and the grass thins, and
      // both are there throughout. So the fields set weights and the plant is
      // drawn from them.
      let total = 0;
      for (let s = 0; s < growing.length; s++) {
        const species = growing[s];
        if (wear > species.tolerates || (species.slope !== undefined && steep > species.slope)) {
          weights[s] = 0;
          continue;
        }
        const drift = drifts[s].at(jx, jy);
        const share = species.punctuates && !sowing.spacing
          ? species.share / spread
          : species.share;
        weights[s] = share * Math.pow(drift, species.clumping);
        total += weights[s];
      }
      if (total <= 0) {
        continue;
      }
      let pick = nextRandom() * total;
      let best = growing.length - 1;
      for (let s = 0; s < growing.length; s++) {
        pick -= weights[s];
        if (pick <= 0) {
          best = s;
          break;
        }
      }

      const species = growing[best];
      // How well this species is doing here, from whole turf down to the last
      // thing hanging on at the edge of the track.
      const vigour = 1 - wear / species.tolerates;
      // Thinning toward whatever this species cannot take, so the mixture
      // changes across the verge as well as the amount — which is what a real
      // path edge does.
      if (nextRandom() > vigour * density) {
        continue;
      }
      const [low, high2] = species.scale;
      // The clump lookup runs the shared stream, so the plant's own draws are
      // re-seeded after it. Deterministic either way; it only has to be stable.
      const clump = clumpAt(jx, jy);
      seedAt(jx + 0.5, jy + 0.5);
      const cx = Math.min(wide - 1, Math.floor(jx / chunkWide));
      const cy = Math.min(high - 1, Math.floor(jy / chunkHigh));
      const bucket = best * chunks + cy * wide + cx;
      (plots[bucket] ??= []).push({
        x: jx,
        y: jy,
        z: surfaceAt(field, jx, jy) - ROOT_SINK,
        // Mostly the clump's heading, a little its own. Plants that grew
        // together lean together — that is what a clump *is* — but a clump
        // where every plant faced identically would be a stamp.
        turn: clump.lean + (nextRandom() - 0.5) * 1.6,
        // Rooted a few degrees off vertical. Nothing grows out of the ground
        // at a right angle, and a meadow where everything does reads as
        // something placed rather than something grown.
        tilt: (nextRandom() - 0.5) * 0.34,
        // <b>Cropped as well as thinned.</b> Thinning alone left the meadow
        // full height right up to a line and then nothing, which is a lawn
        // with a hole cut in it — the one shape a verge never has. Grass
        // beside a track is grazed, trodden and starved: it gets shorter for
        // several feet before it gives up, and that gradient is most of what
        // makes the edge of a path look walked rather than drawn. Cubed
        // toward the vigorous end, so the middle of the meadow is untouched
        // and the last two feet do nearly all of the shortening.
        scale: (low + nextRandom() * (high2 - low)) * clump.tall
          * (0.34 + 0.66 * (1 - (1 - vigour) * (1 - vigour) * (1 - vigour))),
        tone: clump.tone * 0.65 + nextRandom() * 0.35,
        rank: nextRandom(),
      });
    }
  }

  // Everything standing in each chunk, whatever species it is. See Patch.
  const chunkTotals = new Float64Array(chunks);
  for (let s = 0; s < growing.length; s++) {
    for (let chunk = 0; chunk < chunks; chunk++) {
      chunkTotals[chunk] += plots[s * chunks + chunk]?.length ?? 0;
    }
  }

  const meshes: InstancedMesh[] = [];
  const materials: Material[] = [];
  const geometries: BufferGeometry[] = [];
  const patches: Patch[] = [];
  const census: { name: string; plants: number; triangles: number }[] = [];
  let plants = 0;

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const lean = new Quaternion();
  const scale = new Vector3();
  const up = new Vector3(0, 0, 1);
  const across = new Vector3(1, 0, 0);
  const lush = new Color();
  const dry = new Color();
  const tone = new Color();

  growing.forEach((species, s) => {
    const geometry = speciesGeometry(species);
    const material = plantMaterial(species, light, time, viewport, wind, sun);
    const perPlant = (geometry.getIndex()?.count ?? 0) / 3;
    let grown = 0;

    // Two colors rather than a tint on one: the dry end of a July meadow is
    // not the wet end darkened, it is a different, yellower color.
    lush.setHex(species.lush);
    dry.setHex(species.dry);

    for (let chunk = 0; chunk < chunks; chunk++) {
      const plot = plots[s * chunks + chunk];
      if (!plot || plot.length === 0) {
        continue;
      }
      // Sorted so that drawing the first n of them is a fair sample of the
      // whole chunk rather than a wedge of it — which is what makes the
      // detail level below a thinning and not a hole.
      plot.sort((a, b) => a.rank - b.rank);

      const mesh = new InstancedMesh(geometry, material, plot.length);
      mesh.receiveShadow = true;
      mesh.castShadow = species.casts;
      plot.forEach((plant, i) => {
        position.set(plant.x, plant.y, plant.z);
        quaternion.setFromAxisAngle(up, plant.turn);
        lean.setFromAxisAngle(across, plant.tilt);
        quaternion.multiply(lean);
        scale.setScalar(plant.scale);
        mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
        // Multiplies the per-vertex root-to-tip ramp rather than replacing it,
        // so a plant keeps its own shading and only shifts along its range.
        mesh.setColorAt(i, tone.copy(lush).lerp(dry, plant.tone));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
      // Now that a mesh covers one chunk rather than the board, its bounding
      // sphere is a real answer to "is any of this on screen" and culling can
      // be left on. This is the whole point of the chunking.
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;

      meshes.push(mesh);
      patches.push({
        mesh,
        total: plot.length,
        density: chunkTotals[chunk] / (chunkWide * chunkHigh),
      });
      grown += plot.length;
    }

    if (grown === 0) {
      geometry.dispose();
      material.dispose();
      return;
    }
    materials.push(material);
    geometries.push(geometry);
    plants += grown;
    census.push({ name: species.name, plants: grown, triangles: perPlant * grown });
  });

  if (meshes.length === 0) {
    return null;
  }
  return {
    meshes,
    plants,
    census,
    detail(camera: PerspectiveCamera, pixelsHigh: number): void {
      detailFor(patches, camera, pixelsHigh);
    },
    dispose() {
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
    },
  };
}

/** One chunk of one species, and what it takes to decide how much of it to draw. */
interface Patch {
  readonly mesh: InstancedMesh;
  readonly total: number;
  /**
   * Plants per square half-foot *of the whole chunk*, every species counted.
   *
   * <p>Not this species' own density, which was the first attempt and barely
   * did anything: five species each measuring only themselves each concluded
   * they were sparse enough to draw in full, and between them they put six
   * plants in every pixel. They are competing for the same pixel, so they have
   * to be measured against it together — and then thinned by the same factor,
   * which is also what keeps the mixture the mixture.
   */
  readonly density: number;
}

/**
 * Draws as much of each chunk as the picture can actually show.
 *
 * <p>How many plants land in a pixel is the whole question, and it is
 * answerable: it is the chunk's density times the square of how much world one
 * pixel covers. Under the target every plant is drawn; over it, the count is
 * scaled down to meet it. So a board seen whole draws a fraction of its meadow
 * and a board zoomed in draws all of the little that is in view, and in both
 * cases the work is set by the size of the picture rather than the size of the
 * board.
 *
 * <p>Cheap enough to do every frame — a division and a clamp per chunk, and
 * there are on the order of a hundred of them.
 */
function detailFor(
  patches: readonly Patch[],
  camera: PerspectiveCamera,
  pixelsHigh: number,
): void {
  // Half the vertical field, as a tangent: how much world one pixel covers at
  // a distance of one.
  const spread = Math.tan((camera.fov * Math.PI) / 360) * 2;

  for (const patch of patches) {
    const centre = patch.mesh.boundingSphere?.center;
    const away = centre ? camera.position.distanceTo(centre) : 1;
    const worldPerPixel = (spread * away) / Math.max(1, pixelsHigh);
    const perPixel = patch.density * worldPerPixel * worldPerPixel;
    const share = perPixel <= PLANTS_PER_PIXEL
      ? 1
      : Math.max(MIN_DETAIL, PLANTS_PER_PIXEL / perPixel);
    patch.mesh.count = share >= 1
      ? patch.total
      : Math.max(1, Math.ceil(patch.total * share));
  }
}

/**
 * The narrowest a strip is allowed to be on screen, as a half-width in pixels.
 *
 * <p><b>The whole of the grass aliasing problem, and the one thing that can
 * actually fix it.</b> A blade a third of a pixel wide is not an edge waiting
 * to be resolved — it is geometry that falls between the sample points, so it
 * appears and disappears as the camera moves however many samples are taken of
 * it. Multisampling gives a quieter version of the same flicker at four times
 * the bandwidth; the fix is to stop the blade being that thin.
 *
 * <p>So every strip is widened about its own centreline until it holds about a
 * pixel across. Near the camera the clamp never bites and the blade is its real
 * width; far away it stops narrowing and the meadow closes into the solid green
 * a distant field actually is, instead of a boiling stipple of half-blades.
 *
 * <p>Slightly over one, because a strip exactly one pixel wide still lands
 * between two pixel centres half the time.
 */
const MIN_HALF_PIXELS = 0.6;

function plantMaterial(
  species: Species,
  light: (material: Material) => Material,
  time: { value: number },
  viewport: { value: Vector2 },
  wind: { value: number },
  sun: SunUniforms,
): MeshStandardMaterial {
  const material = light(new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
    // Both faces: a leaf has no inside, and half of them face away from any
    // given camera.
    side: DoubleSide,
  })) as MeshStandardMaterial;

  // Composed rather than assigned. `light` has already installed its own
  // `onBeforeCompile`, and a material carries exactly one — overwriting it here
  // would take the board's whole light field off the meadow, which on a board
  // whose point is the light is not a subtle loss.
  const lit = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    lit(shader, renderer);
    shader.uniforms['uBoardTime'] = time;
    shader.uniforms['uViewport'] = viewport;
    shader.uniforms['uWind'] = wind;
    shader.uniforms['uSunDir'] = sun.direction;
    shader.uniforms['uSunGlow'] = sun.glow;
    shader.fragmentShader =
      'varying float vBoardCover;\nvarying float vBoardThin;\nvarying vec3 vBoardLeaf;\n'
      + 'uniform vec3 uSunDir;\nuniform vec3 uSunGlow;\n'
      + shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           // Not all the way: at the far edge of a big board the widening runs
           // to several times, and dimming in full proportion would put the far
           // half of the meadow in shadow for a reason that has nothing to do
           // with light. Most of the way is enough to stop the flowers
           // shouting.
           diffuseColor.rgb *= mix(1.0, clamp(vBoardCover, 0.0, 1.0), 0.7);`)
        .replace(
          '#include <tonemapping_fragment>',
          `{
             // <b>Transmission — light that goes *through* a blade.</b>
             //
             // <p>A leaf is thin, and most of what makes a photograph of a
             // field look like a field is the grass with the sun behind it
             // catching fire. Shaded as an opaque diffuse surface, which is all
             // three does, an evening meadow comes out warm and completely
             // flat: every blade facing away from the sun is simply dark, when
             // in life it is the brightest thing in the picture.
             //
             // <p>Crysis's approximation, and still the standard one: the light
             // arriving on the far side, times how nearly the eye is looking
             // into the sun through the leaf. No thickness map — a tip is
             // thinner than a root and the geometry already knows which is
             // which.
             vec3 boardEye = normalize(cameraPosition - vBoardPos);
             float through = max(0.0, dot(vBoardLeaf, uSunDir));
             float toward = max(0.0, dot(boardEye, uSunDir));
             // A high power, so this is a rim that appears when you look into
             // the light and is absent otherwise — which is what it is. A broad
             // one would just be a second, wronger ambient term.
             float glow = through * pow(toward, 3.0) * (0.25 + 0.75 * vBoardThin);
             gl_FragColor.rgb += uSunGlow * diffuseColor.rgb * glow * 2.2;
           }
           #include <tonemapping_fragment>`);
    shader.vertexShader = 'uniform float uBoardTime;\nuniform float uWind;\nuniform vec2 uViewport;\n'
      + 'attribute vec3 boardSide;\nattribute float boardThin;\n'
      + 'vec3 boardCentre;\nvarying float vBoardCover;\n'
      + 'varying float vBoardThin;\nvarying vec3 vBoardLeaf;\n'
      + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       // Wind, bent by the square of the height up the plant so the root stays
       // planted and the tip does the moving. A plant that swayed evenly would
       // look like it was sliding rather than bending.
       //
       // <p><b>Why this is four terms and not one.</b> A gust phased on
       // distance along the wind alone is a plane wave: everything on a line
       // across the wind leans by exactly the same amount at exactly the same
       // moment, and a meadow doing that reads as a rolling carpet — smooth,
       // regular and obviously mechanical. Real wind over a field is a patch
       // of moving air, and what gives it away is the *lulls*: parts of the
       // field standing still while a gust crosses somewhere else.
       //
       // <p>So there is a slow front that sweeps across and takes the strength
       // down to almost nothing between passes; a body of three waves phased on
       // the crosswind direction as well as the downwind one, which makes the
       // crests patches rather than bands; and a fast term unique to each
       // plant, so neighbours in the same gust are never quite in step.
       vec3 plant = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
       float lead = plant.x * 0.82 + plant.y * 0.57;
       float side = plant.x * -0.57 + plant.y * 0.82;
       float front = 0.18 + 0.82 * max(0.0,
           sin(uBoardTime * 0.29 - lead * 0.031) * 0.6
         + sin(uBoardTime * 0.17 - side * 0.024) * 0.4 + 0.35);
       float body = sin(uBoardTime * 1.9 - lead * 0.28 + side * 0.11) * 0.45
                  + sin(uBoardTime * 3.1 - lead * 0.91 + side * 0.24) * 0.28
                  + sin(uBoardTime * 0.7 - lead * 0.11 - side * 0.06) * 0.27;
       float own = fract(sin(dot(plant.xy, vec2(12.9898, 78.233))) * 43758.545) * 6.2831;
       float gust = (body + sin(uBoardTime * 4.7 + own) * 0.14) * front * uWind;
       float along = clamp(transformed.z, 0.0, 2.2);
       // The wind blows one way across the field, but every plant is turned a
       // random amount, so a push written in the plant's own frame would send
       // each one somewhere different — jitter, not weather. The instance
       // matrix is a turn about Z and a uniform scale, so its normalised
       // columns are the plant's axes, and projecting the wind onto them puts
       // a single world direction back into the plant's frame.
       //
       // <p>Not quite one direction: a little of it is thrown sideways, which
       // is what stops a gust looking like a piston.
       vec3 wind = normalize(vec3(0.82, 0.57, 0.0)
         + vec3(-0.57, 0.82, 0.0) * sin(uBoardTime * 0.43 - lead * 0.05) * 0.3);
       vec2 local = vec2(
         dot(normalize(instanceMatrix[0].xyz), wind),
         dot(normalize(instanceMatrix[1].xyz), wind));
       transformed.xy += local * gust * along * along * ${species.sway.toFixed(3)};
       // Kept before the widening, which needs to know where the middle of the
       // strip is. The wind moves the whole strip, so the offset is unchanged.
       boardCentre = transformed - boardSide;
       vBoardThin = boardThin;
       // The leaf's facing in world space. Three's own shading normal is in
       // view space by the time the fragment shader sees it, and transmission
       // is a question about where the sun is, which is a world-space fact.
       vBoardLeaf = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         // Widen the strip about its centreline until it covers a pixel. Done
         // here because it is a screen-space measurement and this is the first
         // point at which there is a screen to measure against.
         vBoardCover = 1.0;
         {
           vec4 midView = modelViewMatrix
             #ifdef USE_INSTANCING
               * instanceMatrix
             #endif
             * vec4(boardCentre, 1.0);
           vec4 midClip = projectionMatrix * midView;
           if (midClip.w > 0.0001 && gl_Position.w > 0.0001) {
             vec2 mid = midClip.xy / midClip.w;
             vec2 here = gl_Position.xy / gl_Position.w;
             // Half the viewport, because normalised device coordinates run
             // from -1 to 1 across the whole of it.
             float across = length((here - mid) * uViewport * 0.5);
             if (across > 0.0001) {
               float widen = max(1.0, ${MIN_HALF_PIXELS} / across);
               gl_Position.xy = (mid + (here - mid) * widen) * gl_Position.w;
               // A strip widened to twice its true size covers twice the pixels
               // it should, and sends twice the light. Left alone that turns a
               // drift of daisies at forty feet into a sheet of white specks —
               // the flowers get louder as they get further away, which is the
               // opposite of what distance does. Dividing the colour by the
               // same factor puts the total back where it was: this is what an
               // alpha fade would be doing, without the sorting that alpha on a
               // quarter of a million instances would cost.
               vBoardCover = 1.0 / widen;
             }
           }
         }`);
  };
  // Its own key per species, or three hands one of them a program compiled for
  // another and a rosette sways like a seed head — or, worse, a lit material
  // with no wind in it at all and the whole meadow stands still.
  material.customProgramCacheKey = () => `board-meadow-${species.name}`;
  return material;
}
