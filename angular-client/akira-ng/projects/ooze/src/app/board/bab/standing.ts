import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { type GroundField, groundAt, heightAt, noise, slopeAt } from '../ground-field';
import { assetUrl } from './assets';
import type { Cut, FoliageSheet } from './foliage-cards';

/**
 * What stands above the sward: trees, scrub and stone.
 *
 * <p><b>A meadow is mostly grass, and the count is the first decision.</b>
 * Surveys of wood pasture put scattered trees at up to thirty-four the hectare
 * before the habitat stops being open ground and starts being woodland. This
 * board is two hundred and twenty feet by a hundred and fifty — three tenths of
 * a hectare — so the whole map supports about ten trees, and rather fewer if it
 * is grazed. Filling it with trees would not be a prettier meadow, it would be
 * a different habitat.
 *
 * <p><b>And they are not scattered at random.</b> Random is the mistake this
 * renderer already made once with the grass, and it reads as a texture rather
 * than as a place. Trees in pasture stand where something let them: along the
 * boundary, along the track where a mower cannot reach, and as the occasional
 * lone specimen nobody got round to felling. Scrub comes in from the margins
 * and from the verge for the same reason — it is where the grazing stops.
 * Stone shows where the soil is thin, which is the rises and the worn ground.
 *
 * <p>So every kind here is placed by a rule against the ground field the board
 * already has — how worn, how damp, how steep, how near the edge — times its
 * own slow noise, and a candidate that fails the rule is simply not planted.
 */

/** A tree is a trunk and a canopy of cards; both are one merged mesh. */
export interface Standing {
  readonly meshes: readonly Mesh[];
  dispose(): void;
}

/**
 * Trees per hectare, at the open end of wood pasture.
 *
 * <p>Twelve on this board, before the rules refuse any of them. The refusals
 * matter more than the number: a candidate on the track, on a steep bank or in
 * the middle of the open field is thrown away, so the survivors are wherever
 * the board happens to have a margin.
 */
const TREES = 12;
const SCRUB = 54;
const STONES = 26;

/** Half-feet. A hedgerow oak in a Virginia field, give or take. */
const TREE_TALL = 74;

interface Build {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

function empty(): Build {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

/** A stable hash in nought to one, so a board is the same board every load. */
function dice(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * How near the board's own edge a point is, in half-feet, as nought to one
 * across the first twenty.
 *
 * <p>The boundary is where a field's trees are, because the boundary is the one
 * line a plough and a mower both stop at.
 */
function margin(field: GroundField, x: number, y: number): number {
  const near = Math.min(
    x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
  );
  // <b>Nought right at the edge, not one.</b> A tree wants the boundary and it
  // wants to be *inside* it: planted on the line, half its canopy hangs over
  // the rim of the board with nothing under it, which reads as the map being
  // cut out with scissors.
  if (near < 14) {
    return 0;
  }
  return 1 - Math.min(1, (near - 14) / 22);
}

/**
 * Fieldstone, as real geometry rather than cards.
 *
 * <p><b>The one place a downloaded model is the right answer.</b> Poly Haven's
 * vegetation is unusable at any resolution — its pine is a 948 MB geometry
 * buffer and its smallest broadleaf tree is 60 — but a boulder is two or three
 * megabytes, which is why the trees here are built and the stones are not.
 *
 * <p>Scattered as thin instances off one mesh: two dozen rocks is one draw, and
 * a rock has no reason to be its own object until something stands behind it.
 */
export async function scatterStone(
  field: GroundField, scene: Scene,
): Promise<Mesh[]> {
  const names = ['namaqualand_boulder_02', 'namaqualand_boulder_04'];
  const out: Mesh[] = [];
  for (let kind = 0; kind < names.length; kind++) {
    const name = names[kind];
    const box = await LoadAssetContainerAsync(
      assetUrl(`assets/board/models/${name}/${name}.gltf`), scene,
    );
    const rock = box.meshes.find(mesh => mesh.getTotalVertices() > 0) as Mesh | undefined;
    if (!rock) {
      box.dispose();
      continue;
    }
    box.removeAllFromScene();
    rock.name = `stone-${kind}`;
    scene.addMesh(rock);
    if (rock.material) {
      scene.addMaterial(rock.material);
    }
    // glTF is Y-up and so is the stage, so nothing to swap — but the scan's own
    // scale is metres and this board counts half-feet.
    const perMetre = 6.56;
    const matrices: Matrix[] = [];
    for (let at = kind; at < STONES; at += names.length) {
      const x = dice(at, 29, 61) * field.extentXHalfFeet;
      const y = dice(at, 31, 67) * field.extentYHalfFeet;
      // Stone shows where the soil is thin, which on this board is the worn
      // ground beside the track and the rises the plough went round.
      const { wear } = groundAt(field, x, y);
      const steep = slopeAt(field, x, y);
      if (wear < 0.24 && steep < 0.18 && dice(at, 2, 71) > 0.25) {
        continue;
      }
      const size = perMetre * (0.10 + 0.16 * dice(at, 5, 73));
      matrices.push(Matrix.Compose(
        new Vector3(size, size * (0.72 + 0.3 * dice(at, 7, 79)), size),
        Quaternion.FromEulerAngles(
          (dice(at, 11, 83) - 0.5) * 0.4,
          dice(at, 13, 89) * 6.2831853,
          (dice(at, 17, 97) - 0.5) * 0.4,
        ),
        // Sunk a little, so a boulder sits in the ground rather than on it.
        new Vector3(x, heightAt(field, x, y) - size * 0.28, y),
      ));
    }
    if (!matrices.length) {
      rock.dispose();
      continue;
    }
    const packed = new Float32Array(matrices.length * 16);
    matrices.forEach((matrix, at) => matrix.copyToArray(packed, at * 16));
    rock.thinInstanceSetBuffer('matrix', packed, 16);
    rock.receiveShadows = true;
    rock.alwaysSelectAsActiveMesh = true;
    out.push(rock);
  }
  return out;
}

export function raiseStanding(
  field: GroundField, sheet: FoliageSheet, scene: Scene,
): Standing {
  const canopy = sheet.groups['canopy'] ?? [];
  if (!canopy.length) {
    return { meshes: [], dispose: () => undefined };
  }

  const leaves = empty();
  const bark = empty();

  // <b>Trees.</b> A candidate is judged, not placed: it wants a margin or a
  // verge, it will not stand on the track itself, and it will not stand on a
  // bank. What is left is a handful, in the places a handful would be.
  let planted = 0;
  for (let at = 0; at < TREES * 6 && planted < TREES; at++) {
    const x = dice(at, 3, 11) * field.extentXHalfFeet;
    const y = dice(at, 7, 23) * field.extentYHalfFeet;
    const { wear, wet } = groundAt(field, x, y);
    if (wear > 0.58 || slopeAt(field, x, y) > 0.42) {
      continue;
    }
    // Near the boundary, or near the track but off it, or the one in ten that
    // is simply out in the open. A field with trees only round its edge is a
    // paddock; a field with one in the middle of it is a field.
    const edge = margin(field, x, y);
    const verge = wear > 0.18 && wear < 0.5 ? 1 : 0;
    const drift = noise(x * 0.014 + 31.7, y * 0.014 - 12.3);
    const wants = edge * 0.75 + verge * 0.5 + drift * 0.5;
    if (wants < 0.62 && dice(at, 1, 91) > 0.12) {
      continue;
    }
    planted++;
    const tall = TREE_TALL * (0.74 + 0.52 * dice(at, 5, 7));
    const lean = (dice(at, 9, 13) - 0.5) * 0.16;
    addTree(leaves, bark, canopy, x, y, heightAt(field, x, y), tall, lean, at, wet);
  }

  // <b>Scrub.</b> Bramble and thorn come in where the grass is not cut, which
  // is the verge and the boundary. Low, wide and clumped: three or four cards
  // lying almost flat, which is also the only way a bush reads from a camera
  // directly above it.
  for (let at = 0; at < SCRUB * 4; at++) {
    const x = dice(at, 17, 41) * field.extentXHalfFeet;
    const y = dice(at, 19, 53) * field.extentYHalfFeet;
    const { wear } = groundAt(field, x, y);
    if (wear > 0.62) {
      continue;
    }
    const edge = margin(field, x, y);
    const verge = wear > 0.2 && wear < 0.55 ? 1 : 0;
    const drift = noise(x * 0.03 - 8.1, y * 0.03 + 44.2);
    if (edge * 0.7 + verge * 0.6 + drift * 0.7 < 0.78) {
      continue;
    }
    const wide = 3.4 + 4.2 * dice(at, 23, 3);
    addScrub(leaves, canopy, x, y, heightAt(field, x, y), wide, at);
  }

  const sward = new PBRMaterial('standing-leaf', scene);
  sward.metallic = 0;
  sward.roughness = 0.62;
  sward.backFaceCulling = false;
  sward.twoSidedLighting = false;
  sward.albedoTexture = sheet.texture;
  sward.albedoColor = new Color3(1, 1, 1);
  sward.useAlphaFromAlbedoTexture = true;
  sward.transparencyMode = PBRMaterial.MATERIAL_ALPHATEST;
  sward.alphaCutOff = 0.34;
  // The same trade the meadow makes, for the same measured reason: a PBR
  // material with no reflection of its own falls back to the scene's, and the
  // whole irradiance path for an ambient term at 0.14 is the most expensive
  // thing on a leaf.
  (sward as unknown as { _getReflectionTexture(): null })
    ._getReflectionTexture = () => null;
  sward.subSurface.isTranslucencyEnabled = true;
  sward.subSurface.minimumThickness = 0;
  sward.subSurface.maximumThickness = 0.14;
  sward.subSurface.translucencyIntensity = 0.6;
  sward.subSurface.tintColor = new Color3(0.55, 0.72, 0.28);

  const trunk = new PBRMaterial('standing-bark', scene);
  trunk.metallic = 0;
  trunk.roughness = 1;
  const barkColor = new Texture(
    assetUrl('assets/board/polyhaven/bark_brown_02_diff_1k.jpg'), scene, false, false,
  );
  const barkRelief = new Texture(
    assetUrl('assets/board/polyhaven/bark_brown_02_nor_gl_1k.jpg'), scene, false, false,
  );
  const barkSurface = new Texture(
    assetUrl('assets/board/polyhaven/bark_brown_02_arm_1k.jpg'), scene, false, false,
  );
  trunk.albedoTexture = barkColor;
  trunk.bumpTexture = barkRelief;
  trunk.invertNormalMapY = false;
  trunk.metallicTexture = barkSurface;
  trunk.useAmbientOcclusionFromMetallicTextureRed = true;
  trunk.useRoughnessFromMetallicTextureGreen = true;
  trunk.backFaceCulling = false;

  const meshes: Mesh[] = [];
  const put = (build: Build, name: string, material: PBRMaterial): void => {
    if (!build.indices.length) {
      return;
    }
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = build.positions;
    data.normals = build.normals;
    data.uvs = build.uvs;
    data.indices = build.indices;
    data.applyToMesh(mesh);
    mesh.material = material;
    // <b>They cast, and the meadow does not.</b> A tree is the one thing on
    // this board whose shadow is worth a shadow map: it is large, it is sharp
    // at this cascade resolution, and the dark patch under a tree is most of
    // what says there is a tree there at all when the camera is overhead.
    mesh.receiveShadows = true;
    meshes.push(mesh);
  };
  put(leaves, 'standing-leaves', sward);
  put(bark, 'standing-bark', trunk);

  return {
    meshes,
    dispose(): void {
      meshes.forEach(mesh => mesh.dispose());
      sward.dispose();
      trunk.dispose();
      barkColor.dispose();
      barkRelief.dispose();
      barkSurface.dispose();
    },
  };
}

/**
 * One tree: a tapering trunk and a dome of canopy cards.
 *
 * <p><b>The dome is the part that matters on this board.</b> The usual tree
 * billboard is two crossed cards, which is right for a camera standing on the
 * ground and wrong for one looking down — from overhead a crossed pair is a
 * visible X with the sky between its arms. Cards spread over a hemisphere and
 * tilted toward its surface read as a canopy from above *and* from the side,
 * which is what the board actually needs, and it is how a real game tree is
 * built anyway: leaf clusters hung on branches.
 */
function addTree(
  leaves: Build, bark: Build, canopy: readonly Cut[],
  x: number, y: number, ground: number, tall: number, lean: number,
  seed: number, wet: number,
): void {
  const trunkTall = tall * 0.40;
  const thick = tall * 0.026;
  addTrunk(bark, x, y, ground, trunkTall, thick, lean);

  // <b>Enough cards to be a mass.</b> Fifteen spread over a dome is fifteen
  // rectangles with sky between them — the eye finds the cards, not the tree.
  // The number that works is whatever makes them overlap: each card is a third
  // of the canopy across and there are thirty of them, so no line of sight
  // through the crown finds fewer than three.
  // <b>Many small cards, not a few big ones.</b> Thirty cards each most of the
  // crown across is thirty slabs you can count — and counting them is exactly
  // what the eye does, because a clump cut-out drawn large is a solid green
  // rectangle with leaves printed on it. At a third of the size and twice the
  // number they overlap four or five deep everywhere, which is the difference
  // between a canopy and a stack of boxes.
  // <b>Many small cards, not a few big ones.</b> Thirty cards each most of the
  // crown across is thirty slabs you can count — and counting them is exactly
  // what the eye does, because a clump cut-out drawn large is a solid green
  // rectangle with leaves printed on it. At a third of the size and twice the
  // number they overlap four or five deep everywhere, which is the difference
  // between a canopy and a stack of boxes.
  const cards = 58 + Math.floor(dice(seed, 2, 5) * 20);
  const reach = tall * 0.34;
  // Where the crown's middle sits. A tree is not a disc on a stick: the canopy
  // starts not far above the fork and is about as deep as it is wide, which is
  // the whole difference between a tree and a parasol.
  const middle = ground + trunkTall * 0.92 + reach * 0.62;

  for (let n = 0; n < cards; n++) {
    // A ball, filled rather than shelled. Spread around by the golden angle —
    // the cheapest way to cover a sphere without the bands an even sweep
    // leaves — and out from the middle by a cube root, which fills a volume
    // evenly where a plain fraction piles everything at the rim.
    const around = n * 2.39996 + dice(seed, n, 3) * 0.6;
    const deep = Math.cbrt((n + 0.5) / cards) * (0.72 + 0.36 * dice(seed, n, 29));
    const up = dice(seed, n, 61) * 2 - 1;
    const ring = Math.sqrt(Math.max(0, 1 - up * up));
    const cx = x + Math.cos(around) * ring * deep * reach;
    const cy = y + Math.sin(around) * ring * deep * reach;
    // Flattened a little: a crown is wider than it is tall, and the underside
    // is the part a board camera never sees.
    const cz = middle + up * deep * reach * 0.74;
    const size = reach * (0.30 + 0.24 * dice(seed, n, 17));
    // Facing out along the ball, so a card near the top presents itself to a
    // camera above and one at the rim presents itself sideways.
    addCanopyCard(
      leaves, canopy[(seed * 3 + n) % canopy.length],
      cx + lean * (cz - ground), cy, cz, size,
      around, Math.max(0.05, up * 0.5 + 0.5), dice(seed, n, 41), wet,
    );
  }
}

/** Bramble and thorn: the same cards, low and wide and lying over. */
function addScrub(
  leaves: Build, canopy: readonly Cut[],
  x: number, y: number, ground: number, wide: number, seed: number,
): void {
  const cards = 3 + Math.floor(dice(seed, 4, 9) * 3);
  for (let n = 0; n < cards; n++) {
    const around = n * 2.39996 + dice(seed, n, 6) * 0.9;
    const away = wide * 0.32 * Math.sqrt(dice(seed, n, 12));
    addCanopyCard(
      leaves, canopy[(seed + n) % canopy.length],
      x + Math.cos(around) * away, y + Math.sin(around) * away,
      ground + wide * (0.16 + 0.2 * dice(seed, n, 18)),
      wide * (0.5 + 0.3 * dice(seed, n, 21)),
      around, 0.72, dice(seed, n, 33), 0,
    );
  }
}

/**
 * One card of foliage, at a point, facing out along the dome it belongs to.
 *
 * <p>Its silhouette is followed the same way the meadow's is — the two columns
 * of vertices sit on the outline the packer recorded rather than on a bounding
 * box — because alpha testing shades a fragment before it discards it, so the
 * empty corners of a canopy card are paid for at full price.
 */
function addCanopyCard(
  build: Build, cut: Cut,
  x: number, y: number, z: number, size: number,
  around: number, up: number, roll: number, wet: number,
): void {
  const wide = size * cut.aspect;
  const ca = Math.cos(around);
  const sa = Math.sin(around);

  // The card's own frame: `face` points out along the dome, `across` is
  // horizontal and square to it, `along` completes the pair.
  const flat = Math.sqrt(Math.max(0.0001, 1 - up * up));
  const face: Vec = [ca * flat, up, sa * flat];
  const across: Vec = [-sa, 0, ca];
  const along: Vec = cross(face, across);

  // A little roll about the facing axis, so twenty cards on one dome are not
  // twenty copies of the same rectangle.
  const cr = Math.cos(roll * 6.2831853);
  const sr = Math.sin(roll * 6.2831853);
  const u: Vec = add(scale(across, cr), scale(along, sr));
  const v: Vec = add(scale(across, -sr), scale(along, cr));

  const rows = 2;
  const first = build.positions.length / 3;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const edge = spanOf(cut, t);
    // Leaves are paler and yellower where the ground is dry, and the wet end of
    // a field is where a tree is greenest. It is the same fact the sward's own
    // drift reads, said once more on something taller.
    const height = (t - 0.5) * size;
    for (const side of [0, 1] as const) {
      const off = (edge[side] - 0.5) * wide;
      build.positions.push(
        x + u[0] * off + v[0] * height,
        z + u[1] * off + v[1] * height,
        y + u[2] * off + v[2] * height,
      );
      // Normals fan from the dome's own outward direction rather than the
      // card's: a canopy is a rough sphere of leaves and lights like one, and a
      // card lit by its own flat normal reads as a signboard in a tree.
      const lifted = add(face, scale(u, (side === 0 ? -0.5 : 0.5)));
      build.normals.push(...unit(lifted));
      build.uvs.push(
        cut.u0 + (cut.u1 - cut.u0) * edge[side],
        cut.v1 + (cut.v0 - cut.v1) * t,
      );
    }
  }
  for (let row = 0; row < rows; row++) {
    const a = first + row * 2;
    build.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  void wet;
}

/** Four sides of a tapering trunk. Cheap, and nobody is under it. */
function addTrunk(
  build: Build, x: number, y: number, ground: number,
  tall: number, thick: number, lean: number,
): void {
  const sides = 5;
  const first = build.positions.length / 3;
  for (let ring = 0; ring <= 1; ring++) {
    const height = ring * tall;
    // A trunk is thickest where it meets the ground and the flare is most of
    // what stops it reading as a post stuck in a field.
    const size = thick * (ring === 0 ? 1.45 : 0.62);
    for (let side = 0; side <= sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      build.positions.push(
        x + nx * size + lean * height, ground + height, y + nz * size,
      );
      build.normals.push(nx, 0.16, nz);
      build.uvs.push(side / sides, height / (thick * 26));
    }
  }
  for (let side = 0; side < sides; side++) {
    const a = first + side;
    const b = first + sides + 1 + side;
    build.indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
}

type Vec = readonly [number, number, number];

function spanOf(cut: Cut, t: number): readonly [number, number] {
  const spans = cut.spans;
  if (!spans?.length) {
    return [0, 1];
  }
  const at = Math.min(spans.length - 1, Math.max(0, t * (spans.length - 1)));
  const low = Math.floor(at);
  const high = Math.min(spans.length - 1, low + 1);
  const mix = at - low;
  return [
    spans[low][0] + (spans[high][0] - spans[low][0]) * mix,
    spans[low][1] + (spans[high][1] - spans[low][1]) * mix,
  ];
}

function cross(a: Vec, b: Vec): Vec {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function add(a: Vec, b: Vec): Vec {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec, by: number): Vec {
  return [a[0] * by, a[1] * by, a[2] * by];
}

function unit(v: Vec): Vec {
  const size = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / size, v[1] / size, v[2] / size];
}
