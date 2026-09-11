import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Materials/material.detailMapConfiguration';
import type { SplatGround } from '../board-assets';
import { type GroundField, groundAt, heightAt } from '../ground-field';
import { assetUrl } from './assets';
import { bakeGround } from './splat-bake';

/**
 * The ground.
 *
 * <p>Two textures where there were fifty: a baked map of the whole board for
 * everything that varies slowly — which layer, how worn, how wet, the drift
 * across the field — and one tiling photograph on top of it for the grain you
 * only see when the camera comes down. That pairing is what every terrain
 * renderer does, and it is in the box here as `detailMap`.
 *
 * <p>The old ground was a single 1,056,000-triangle mesh with one bounding
 * sphere, so no camera angle could ever cull any of it. This is a grid of
 * chunks that can be, and it is a quarter the triangles besides — the relief
 * was oversampled at two vertices to the half-foot, which is finer than the
 * height field it was reading from.
 */

/** Vertices per half-foot. The field itself has three texels; this reads it. */
const MESH_DETAIL = 1;

/** Half-feet across a chunk, so a camera looking at one end can drop the other. */
const CHUNK_HALF_FEET = 60;

export interface Terrain {
  readonly chunks: Mesh[];
  /**
   * The sward, as something the shadow map can see.
   *
   * <p>The meadow casts no shadow: six hundred thousand blades rendered again
   * into every cascade is the most expensive thing a board like this can do,
   * and no shipping game does it. What *Ghost of Tsushima* does instead is
   * raise the terrain to grass height in the shadow pass, so the field casts a
   * soft aggregate shadow without a single blade entering the map. These are
   * that: the same chunks, lifted by how tall the sward stands at each point,
   * drawn only into the cascades and never by the camera.
   *
   * <p>What it buys is the road. Under the sward the shadow falls on ground
   * that is hidden by grass anyway; on the bare track beside it, at any sun low
   * enough to matter, a foot and a half of dense meadow throws a real shadow —
   * and until now the road was lit as though the field beside it were painted
   * on.
   */
  readonly swardProxy: Mesh[];
  readonly material: PBRMaterial;
  dispose(): void;
}

/**
 * Half-feet the sward stands, for the shadow it casts.
 *
 * <p>Under the tallest plants and over the shortest: the shadow comes from the
 * bulk of a sward rather than from the seed heads standing above it, and a
 * proxy at the height of the tips would put the road in shadow a stride too
 * early.
 */
const SWARD_HALF_FEET = 2.3;

/**
 * The layer the shadow proxy lives on.
 *
 * <p>A render target given an explicit render list does not check `layerMask`,
 * and the shadow map is given one — so a mesh on a layer the camera does not
 * look at is still drawn into every cascade. That is the whole mechanism: no
 * second material, no visibility flag the shadow pass would also honour.
 */
const SHADOW_ONLY_LAYER = 0x20000000;

/** The same smoothstep the ground's bake uses, so the two edges agree. */
function smoothTo(value: number, from: number, to: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * Our world is Z-up in half-feet; Babylon is Y-up. One swap, in one place,
 * rather than a rotated root node — a root rotation quietly follows every
 * bounding box, every ray cast and every shadow frustum around with it, and
 * being able to read a vertex position as the board's own coordinates is worth
 * more than the tidiness.
 */
export function toStage(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

export function buildTerrain(
  ground: SplatGround, field: GroundField, scene: Scene,
): Terrain {
  const { macro, relief, surface, sources } = bakeGround(ground, field, scene);

  const material = new PBRMaterial('ground', scene);
  material.albedoTexture = macro;

  // <b>The ground has relief and gloss of its own now, and it always did on
  // disk.</b> Every Poly Haven layer ships a normal map and a packed
  // occlusion-roughness-metalness map beside its colour, and this material read
  // neither: one flat albedo at a fixed roughness of 0.92. That is why a road
  // with ruts cut into it read as a brown stripe painted on a plane — the ruts
  // were in the photograph and nothing in the lighting knew about them.
  //
  // <p>Both are baked through the same splat blend as the colour, so the road's
  // clods, the verge's stones and the turf agree about where they stop.
  material.bumpTexture = relief;
  // Poly Haven's normals are OpenGL convention, which is the one Babylon reads
  // without inverting. The file names say so — `nor_gl`.
  material.invertNormalMapY = false;
  material.bumpTexture.level = 0.85;

  material.metallicTexture = surface;
  material.useAmbientOcclusionFromMetallicTextureRed = true;
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = true;
  material.metallic = 0;
  // A multiplier on what the map says now, rather than the whole answer. Wet
  // clay and dry turf are not the same gloss and never were.
  material.roughness = 1;
  // No specular from a dirt road worth the name. Left at the default it reads
  // as wet tarmac the moment the sun gets low.
  material.specularIntensity = 0.15;
  // There is no underside of a hillside worth drawing, but the skirt is seen
  // edge-on at the board's rim and a hole there reads as a bug.
  material.backFaceCulling = false;

  // The near-field grain the baked map cannot hold: at four texels to the
  // half-foot a blade of grass is a quarter of a texel, so the bake carries
  // where the grass *is* and this carries what it looks like up close.
  const detail = new Texture(assetUrl(ground.layers[0].color), scene, false, false);
  detail.wrapU = Texture.WRAP_ADDRESSMODE;
  detail.wrapV = Texture.WRAP_ADDRESSMODE;
  detail.uScale = field.extentXHalfFeet / (ground.layers[0].feet * 2);
  detail.vScale = field.extentYHalfFeet / (ground.layers[0].feet * 2);
  material.detailMap.texture = detail;
  material.detailMap.isEnabled = true;
  material.detailMap.diffuseBlendLevel = 0.18;
  material.detailMap.roughnessBlendLevel = 0.3;

  const chunks: Mesh[] = [];
  const swardProxy: Mesh[] = [];
  const across = Math.ceil(field.extentXHalfFeet / CHUNK_HALF_FEET);
  const along = Math.ceil(field.extentYHalfFeet / CHUNK_HALF_FEET);
  for (let cy = 0; cy < along; cy++) {
    for (let cx = 0; cx < across; cx++) {
      const x0 = cx * CHUNK_HALF_FEET;
      const y0 = cy * CHUNK_HALF_FEET;
      const x1 = Math.min(field.extentXHalfFeet, x0 + CHUNK_HALF_FEET);
      const y1 = Math.min(field.extentYHalfFeet, y0 + CHUNK_HALF_FEET);
      chunks.push(chunkMesh(field, material, scene, x0, y0, x1, y1, `ground-${cx}-${cy}`));
      const proxy = chunkMesh(
        field, material, scene, x0, y0, x1, y1, `sward-${cx}-${cy}`, true,
      );
      proxy.layerMask = SHADOW_ONLY_LAYER;
      // <b>It keeps the terrain's material, and nulling it deleted the whole
      // feature.</b> Nothing samples this mesh and nothing lights it — the
      // shadow pass draws it with its own depth effect — so a null material
      // looked like honesty. It is not: `RenderingGroup.dispatch` returns
      // immediately on a null material, and so does the shadow generator, and a
      // default material is only substituted when `StandardMaterial` has been
      // imported, which this board never does. So these forty chunks were
      // built, uploaded, culled and never drawn, and the field cast nothing on
      // the road for as long as the proxy has existed.
      swardProxy.push(proxy);
    }
  }

  return {
    chunks,
    swardProxy,
    material,
    dispose(): void {
      chunks.forEach(chunk => chunk.dispose());
      swardProxy.forEach(chunk => chunk.dispose());
      material.dispose();
      macro.dispose();
      sources.forEach(texture => texture.dispose());
      detail.dispose();
      relief.dispose();
      surface.dispose();
    },
  };
}

function chunkMesh(
  field: GroundField, material: PBRMaterial, scene: Scene,
  x0: number, y0: number, x1: number, y1: number, name: string,
  sward = false,
): Mesh {
  // One vertex past the far edge, so neighbouring chunks share their seam
  // vertices exactly and no crack opens between them.
  const cols = Math.max(1, Math.round((x1 - x0) * MESH_DETAIL)) + 1;
  const rows = Math.max(1, Math.round((y1 - y0) * MESH_DETAIL)) + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = x0 + ((x1 - x0) * col) / (cols - 1 || 1);
      const y = y0 + ((y1 - y0) * row) / (rows - 1 || 1);
      // The sward proxy stands on the same ground, lifted by how much meadow
      // is growing there. The taper matches the one the ground's own colour
      // uses, so the shadow stops exactly where the grass does and the road
      // casts nothing onto itself.
      const lift = sward
        ? SWARD_HALF_FEET * (1 - smoothTo(groundAt(field, x, y).wear, 0.40, 0.82))
        : 0;
      const z = heightAt(field, x, y) + lift;
      const at = (row * cols + col) * 3;
      const [sx, sy, sz] = toStage(x, y, z);
      positions[at] = sx;
      positions[at + 1] = sy;
      positions[at + 2] = sz;
      const uv = (row * cols + col) * 2;
      // The baked map covers the board exactly, so a vertex's UV is simply
      // where it stands. Nothing to pack, nothing to atlas.
      uvs[uv] = x / field.extentXHalfFeet;
      uvs[uv + 1] = y / field.extentYHalfFeet;
    }
  }

  let write = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Wound for Babylon's left-handed frame. Our board is right-handed with
      // Z up, and `toStage` swaps two axes to reach Y up — which reverses
      // orientation. Wound the other way, `ComputeNormals` returns normals
      // pointing straight *down*: the ground is then lit from underneath and
      // renders black under a midday sun, while still looking green at
      // distance because image-based light has no direction to get wrong.
      indices[write++] = a; indices[write++] = b; indices[write++] = c;
      indices[write++] = b; indices[write++] = d; indices[write++] = c;
    }
  }

  const normals = new Float32Array(positions.length);
  VertexData.ComputeNormals(positions, indices, normals);

  // <b>No tangents, and it was tried.</b> With a normal map and no tangent
  // frame the fragment shader rebuilds a cotangent basis per pixel — four
  // screen-space derivatives, two cross products and a normalise — and this
  // mesh's uv is a planar projection of the board, so the tangent is analytic:
  // the stage's x with the surface normal taken out of it. Supplying it as a
  // vertex buffer produced a stream of WebGPU validation errors and a board
  // that drew nothing. Not chased further, because the terrain is one fragment
  // deep over every pixel and the meadow over it is several — this was the
  // smallest of the savings on offer and the only one that broke the picture.

  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;

  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.receiveShadows = true;
  mesh.freezeWorldMatrix();
  return mesh;
}

export { MESH_DETAIL, CHUNK_HALF_FEET };
