import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Materials/material.detailMapConfiguration';
import type { SplatGround } from '../board-assets';
import { type GroundField, heightAt } from '../ground-field';
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
  readonly material: PBRMaterial;
  dispose(): void;
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
  const { macro, sources } = bakeGround(ground, field, scene);

  const material = new PBRMaterial('ground', scene);
  material.albedoTexture = macro;
  material.metallic = 0;
  material.roughness = 0.92;
  // No specular from a dirt road worth the name. Left at the default it reads
  // as wet tarmac the moment the sun gets low.
  material.specularIntensity = 0.15;
  material.ambientColor = new Color3(1, 1, 1);
  // Terrain is a heightfield seen from above, and the axis swap that turns our
  // right-handed Z-up board into Babylon's left-handed Y-up reverses triangle
  // winding. Rather than reason about which way that lands, draw both sides:
  // there is no inside of a hillside to see, and it removes a whole class of
  // "the ground is missing" bug.
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
  const across = Math.ceil(field.extentXHalfFeet / CHUNK_HALF_FEET);
  const along = Math.ceil(field.extentYHalfFeet / CHUNK_HALF_FEET);
  for (let cy = 0; cy < along; cy++) {
    for (let cx = 0; cx < across; cx++) {
      const x0 = cx * CHUNK_HALF_FEET;
      const y0 = cy * CHUNK_HALF_FEET;
      const x1 = Math.min(field.extentXHalfFeet, x0 + CHUNK_HALF_FEET);
      const y1 = Math.min(field.extentYHalfFeet, y0 + CHUNK_HALF_FEET);
      chunks.push(chunkMesh(field, material, scene, x0, y0, x1, y1, `ground-${cx}-${cy}`));
    }
  }

  return {
    chunks,
    material,
    dispose(): void {
      chunks.forEach(chunk => chunk.dispose());
      material.dispose();
      macro.dispose();
      sources.forEach(texture => texture.dispose());
      detail.dispose();
    },
  };
}

function chunkMesh(
  field: GroundField, material: PBRMaterial, scene: Scene,
  x0: number, y0: number, x1: number, y1: number, name: string,
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
      const z = heightAt(field, x, y);
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
      indices[write++] = a; indices[write++] = c; indices[write++] = b;
      indices[write++] = b; indices[write++] = c; indices[write++] = d;
    }
  }

  const normals = new Float32Array(positions.length);
  VertexData.ComputeNormals(positions, indices, normals);

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
