import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, Material, Matrix4,
  MeshStandardMaterial, Quaternion, Vector3,
} from 'three';
import { BoardScene } from './board.models';
import { GroundField, groundAt, heightAt, noise } from './ground-field';
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
 */

/** Half-feet between candidate plants, before jitter. */
const STRIDE = 0.6;

/**
 * How far a root is pushed under the ground, in half-feet.
 *
 * <p>Sinking a root is invisible; floating one is a plant hovering over a
 * field, which is what happens at every hoofprint if the height is taken from
 * the field rather than from the surface the mesh actually interpolates.
 */
const ROOT_SINK = 0.06;

/** One strip of a plant: a tapered, arching ribbon from the root outward. */
interface Strip {
  /** Where on the clump it is rooted, in half-feet from the middle. */
  rootX: number;
  rootY: number;
  /** Which way it leans. */
  yaw: number;
  /** How tall, before the instance's own scale. */
  tall: number;
  /** How far it leans out by the tip, as a fraction of its height. */
  bend: number;
  /** Half-width at the root. */
  width: number;
  /** How much of the width survives to the tip. */
  taper: number;
  /** Sections along it. Three reads as a curve; one reads as a shard. */
  segments: number;
  root: number;
  tip: number;
}

interface Species {
  readonly name: string;
  /** How much of the meadow it takes where it is winning. */
  readonly share: number;
  /** Repeats per half-foot of its patch field: how big its drifts are. */
  readonly patch: number;
  /** How hard it clusters. Zero would scatter it evenly and defeat the point. */
  readonly clumping: number;
  /**
   * How worn the ground may be and still grow it.
   *
   * <p>Not one number for the meadow, because it is not one meadow. Rank grass
   * gives up the moment anything walks on it; plantain is called "the white
   * man's footprint" precisely because it grows *on* the trodden part, and a
   * verge with plantain on it and nothing else is a verge somebody uses.
   */
  readonly tolerates: number;
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
   * rather than painted on it. So the tall species cast and the mat does not,
   * which is a small fraction of the plants and nearly all of the depth.
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
    root: 0x3d5423, tip: 0x9cb85a,
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
    root: 0x4a5b2a, tip: 0xb8b46a,
  }));
  const heads = stalks.flatMap(stalk => [0, 1].map(k => ({
    // Rooted where the stalk's tip lands, so the head sits on the stalk rather
    // than beside it: the lean is bend times height, along the stalk's yaw.
    rootX: stalk.rootX + Math.cos(stalk.yaw) * stalk.bend * stalk.tall,
    rootY: stalk.rootY + Math.sin(stalk.yaw) * stalk.bend * stalk.tall,
    yaw: stalk.yaw + k * Math.PI / 2,
    tall: 0.5, bend: 0.1,
    width: 0.07, taper: 0.45, segments: 3,
    root: 0xa39a5c, tip: 0xd6cf92,
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
    width: 0.17, taper: 0.35, segments: 3,
    root: 0x2f4a1c, tip: 0x6f8f3c,
  }));
}

/** Clover: low three-lobed cover that mats the gaps between the grass. */
function cloverStrips(): Strip[] {
  return spread(7, 0.42, (i, yaw, rootX, rootY) => {
    const stem = 0.3 + ((i * 5) % 3) * 0.06;
    return [
      { rootX, rootY, yaw, tall: stem, bend: 0.2, width: 0.02, taper: 0.6,
        segments: 2, root: 0x35521f, tip: 0x4f7a2c },
      ...[0, 1, 2].map(lobe => ({
        rootX, rootY, yaw: yaw + lobe * 2.094,
        tall: 0.16, bend: 1.6, width: 0.1, taper: 0.9, segments: 2,
        root: 0x4f7a2c, tip: 0x7ba33f, lift: stem,
      } as Strip & { lift: number })),
    ];
  }).flat() as Strip[];
}

/** Wildflowers, which grow in drifts and are most of the color in a July field. */
function flowerStrips(): Strip[] {
  return spread(3, 0.3, (i, yaw, rootX, rootY) => {
    const stem = 1.9 + (i % 2) * 0.35;
    return [
      { rootX, rootY, yaw, tall: stem, bend: 0.22, width: 0.022, taper: 0.7,
        segments: 3, root: 0x415c22, tip: 0x6c8a39 },
      ...[0, 1, 2, 3, 4].map(petal => ({
        rootX, rootY, yaw: yaw + petal * 1.2566,
        tall: 0.2, bend: 1.1, width: 0.07, taper: 0.55, segments: 2,
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

const SPECIES: readonly Species[] = [
  {
    name: 'grass', share: 1, patch: 0.035, clumping: 1, tolerates: 0.42,
    scale: [0.7, 1.5], sway: 0.16, casts: false,
    lush: 0x6f8a3a, dry: 0xb0ab5c, strips: grassStrips,
  },
  {
    name: 'seed', share: 0.9, patch: 0.05, clumping: 2, tolerates: 0.3,
    scale: [0.9, 1.4], sway: 0.26, casts: true,
    lush: 0x8e9a52, dry: 0xc4b878, strips: seedStrips,
  },
  {
    name: 'clover', share: 0.95, patch: 0.07, clumping: 2, tolerates: 0.55,
    scale: [0.9, 1.5], sway: 0.05, casts: false,
    lush: 0x6d9c3c, dry: 0x8fae52, strips: cloverStrips,
  },
  {
    name: 'broadleaf', share: 0.75, patch: 0.09, clumping: 2, tolerates: 0.72,
    scale: [0.8, 1.6], sway: 0.04, casts: false,
    lush: 0x6f9440, dry: 0x93a054, strips: broadleafStrips,
  },
  {
    name: 'flower', share: 0.5, patch: 0.16, clumping: 4, tolerates: 0.26,
    scale: [0.85, 1.25], sway: 0.3, casts: true,
    lush: 0xefe8d2, dry: 0xd8bf5e, strips: flowerStrips,
  },
];

export interface Meadow {
  readonly meshes: readonly InstancedMesh[];
  /** Individual plants standing on the board, for the readout. */
  readonly plants: number;
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
  const root = new Color();
  const tip = new Color();
  const shade = new Color();
  let vertex = 0;

  for (const strip of species.strips()) {
    const cos = Math.cos(strip.yaw);
    const sin = Math.sin(strip.yaw);
    const lift = (strip as Strip & { lift?: number }).lift ?? 0;
    root.setHex(strip.root);
    tip.setHex(strip.tip);

    for (let i = 0; i <= strip.segments; i++) {
      const t = i / strip.segments;
      const halfWidth = strip.width * (1 - t * (1 - strip.taper));
      // Height eases off as the strip leans over, and the lean grows faster
      // than the height, so the last third is nearly horizontal.
      const up = lift + Math.sin(t * Math.PI * 0.5) * strip.tall;
      const out = t * t * strip.bend * strip.tall;
      shade.copy(root).lerp(tip, t * t);

      for (const side of [-1, 1]) {
        const across = side * halfWidth;
        positions.push(
          strip.rootX + cos * out - sin * across,
          strip.rootY + sin * out + cos * across,
          up,
        );
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
}

/**
 * Everything growing on a board.
 *
 * @param light patches a material to answer to the board's light field
 * @param time the shared clock uniform, so the wind moves
 * @param density what fraction of candidate spots grow, where the turf is whole
 */
export function meadow(
  board: BoardScene,
  field: GroundField,
  light: (material: Material) => Material,
  time: { value: number },
  density: number,
): Meadow | null {
  const plots: Plant[][] = SPECIES.map(() => []);
  const weights = new Float64Array(SPECIES.length);

  for (let y = STRIDE / 2; y < board.heightHalfFeet; y += STRIDE) {
    for (let x = STRIDE / 2; x < board.widthHalfFeet; x += STRIDE) {
      const jx = x + (hash(x, y, 3) - 0.5) * STRIDE;
      const jy = y + (hash(x, y, 5) - 0.5) * STRIDE;
      const { wear, wet } = groundAt(field, jx, jy);
      if (wet > 0.3) {
        continue;
      }

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
      for (let s = 0; s < SPECIES.length; s++) {
        const species = SPECIES[s];
        if (wear > species.tolerates) {
          weights[s] = 0;
          continue;
        }
        const drift = noise(jx * species.patch + s * 37.3, jy * species.patch + s * 91.7);
        weights[s] = species.share * Math.pow(drift, species.clumping);
        total += weights[s];
      }
      if (total <= 0) {
        continue;
      }
      let pick = hash(jx, jy, 29) * total;
      let best = SPECIES.length - 1;
      for (let s = 0; s < SPECIES.length; s++) {
        pick -= weights[s];
        if (pick <= 0) {
          best = s;
          break;
        }
      }

      const species = SPECIES[best];
      // How well this species is doing here, from whole turf down to the last
      // thing hanging on at the edge of the track.
      const vigour = 1 - wear / species.tolerates;
      // Thinning toward whatever this species cannot take, so the mixture
      // changes across the verge as well as the amount — which is what a real
      // path edge does.
      if (hash(jx, jy, 7) > vigour * density) {
        continue;
      }
      const [low, high] = species.scale;
      plots[best].push({
        x: jx,
        y: jy,
        z: surfaceAt(field, jx, jy) - ROOT_SINK,
        turn: hash(jx, jy, 11) * Math.PI * 2,
        // Rooted a few degrees off vertical. Nothing grows out of the ground
        // at a right angle, and a meadow where everything does reads as
        // something placed rather than something grown.
        tilt: (hash(jx, jy, 17) - 0.5) * 0.34,
        // <b>Cropped as well as thinned.</b> Thinning alone left the meadow
        // full height right up to a line and then nothing, which is a lawn
        // with a hole cut in it — the one shape a verge never has. Grass
        // beside a track is grazed, trodden and starved: it gets shorter for
        // several feet before it gives up, and that gradient is most of what
        // makes the edge of a path look walked rather than drawn. Cubed
        // toward the vigorous end, so the middle of the meadow is untouched
        // and the last two feet do nearly all of the shortening.
        scale: (low + hash(jx, jy, 13) * (high - low))
          * (0.34 + 0.66 * (1 - (1 - vigour) * (1 - vigour) * (1 - vigour))),
        tone: hash(jx, jy, 19),
      });
    }
  }

  const meshes: InstancedMesh[] = [];
  const materials: Material[] = [];
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

  SPECIES.forEach((species, s) => {
    const plot = plots[s];
    if (plot.length === 0) {
      return;
    }
    const material = plantMaterial(species, light, time);
    const mesh = new InstancedMesh(speciesGeometry(species), material, plot.length);
    mesh.receiveShadow = true;
    mesh.castShadow = species.casts;
    // An instanced mesh's bounding sphere is one *plant's*, so three would
    // cull the entire meadow the moment the camera left one square foot of it.
    mesh.frustumCulled = false;

    // Two colors rather than a tint on one: the dry end of a July meadow is
    // not the wet end darkened, it is a different, yellower color.
    lush.setHex(species.lush);
    dry.setHex(species.dry);
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
    meshes.push(mesh);
    materials.push(material);
    plants += plot.length;
  });

  if (meshes.length === 0) {
    return null;
  }
  return {
    meshes,
    plants,
    dispose() {
      meshes.forEach(mesh => mesh.geometry.dispose());
      materials.forEach(material => material.dispose());
    },
  };
}

function plantMaterial(
  species: Species,
  light: (material: Material) => Material,
  time: { value: number },
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
    shader.vertexShader = 'uniform float uBoardTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       // Wind, bent by the square of the height up the plant so the root stays
       // planted and the tip does the moving. A blade that swayed evenly would
       // look like it was sliding rather than bending.
       //
       // <b>The gust has to be a wave, not a beat.</b> A phase taken from the
       // plant's position alone gives everything within about ten feet the
       // same value, so the whole near field leans together and the meadow
       // reads as combed. Three frequencies at three wavelengths, the longest
       // of them tens of feet across, put crests between the leaning parts and
       // the still ones — which is what wind over grass actually looks like.
       vec3 plant = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
       float lead = plant.x * 0.82 + plant.y * 0.57;
       float gust = sin(uBoardTime * 1.9 - lead * 0.28) * 0.45
                  + sin(uBoardTime * 3.1 - lead * 0.91) * 0.28
                  + sin(uBoardTime * 0.7 - lead * 0.11) * 0.27;
       float along = clamp(transformed.z, 0.0, 2.2);
       // The wind blows one way across the field, but every plant is turned a
       // random amount, so a push written in the plant's own frame would send
       // each one somewhere different — jitter, not weather. The instance
       // matrix is a turn about Z and a uniform scale, so its normalised
       // columns are the plant's axes, and projecting the wind onto them puts
       // a single world direction back into the plant's frame.
       vec3 wind = vec3(0.82, 0.57, 0.0);
       vec2 local = vec2(
         dot(normalize(instanceMatrix[0].xyz), wind),
         dot(normalize(instanceMatrix[1].xyz), wind));
       transformed.xy += local * gust * along * along * ${species.sway.toFixed(3)};`);
  };
  // Its own key per species, or three hands one of them a program compiled for
  // another and a rosette sways like a seed head — or, worse, a lit material
  // with no wind in it at all and the whole meadow stands still.
  material.customProgramCacheKey = () => `board-meadow-${species.name}`;
  return material;
}

function hash(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
