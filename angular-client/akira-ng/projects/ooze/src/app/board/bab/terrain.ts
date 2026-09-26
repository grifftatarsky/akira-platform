import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { SplatGround } from '../board-assets';
import { type GroundField, groundAt, heightAt } from '../ground-field';
import { assetUrl } from './assets';
import { GRASS_FADE_FROM, GRASS_FADE_TO } from './species';
import { bakeGround } from './splat-bake';

const MESH_DETAIL = 1;

const CHUNK_HALF_FEET = 60;

export interface Terrain {
  readonly chunks: Mesh[];

  readonly grassProxy: Mesh[];
  readonly material: PBRMaterial;
  dispose(): void;
}

const GRASS_HALF_FEET = 2.3;

const SHADOW_ONLY_LAYER = 0x20000000;

function smoothTo(value: number, from: number, to: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export function toStage(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

export function buildTerrain(
  ground: SplatGround, field: GroundField, scene: Scene,
): Terrain {
  const { macro, relief, surface, sources } = bakeGround(ground, field, scene);

  const material = new PBRMaterial('ground', scene);
  material.albedoTexture = macro;

  material.bumpTexture = relief;

  material.invertNormalMapY = false;
  material.bumpTexture.level = 0.85;

  material.metallicTexture = surface;
  material.useAmbientOcclusionFromMetallicTextureRed = true;
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = true;
  material.metallic = 0;

  material.roughness = 1;

  material.specularIntensity = 0.15;

  material.backFaceCulling = false;

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
  const grassProxy: Mesh[] = [];
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
        field, material, scene, x0, y0, x1, y1, `grass-${cx}-${cy}`, true,
      );
      proxy.layerMask = SHADOW_ONLY_LAYER;

      grassProxy.push(proxy);
    }
  }

  return {
    chunks,
    grassProxy,
    material,
    dispose(): void {
      chunks.forEach(chunk => chunk.dispose());
      grassProxy.forEach(chunk => chunk.dispose());
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
  grass = false,
): Mesh {

  const cols = Math.max(1, Math.round((x1 - x0) * MESH_DETAIL)) + 1;
  const rows = Math.max(1, Math.round((y1 - y0) * MESH_DETAIL)) + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = x0 + ((x1 - x0) * col) / (cols - 1 || 1);
      const y = y0 + ((y1 - y0) * row) / (rows - 1 || 1);

      const lift = grass
        ? GRASS_HALF_FEET
          * (1 - smoothTo(groundAt(field, x, y).wear, GRASS_FADE_FROM, GRASS_FADE_TO))
        : 0;
      const z = heightAt(field, x, y) + lift;
      const at = (row * cols + col) * 3;
      const [sx, sy, sz] = toStage(x, y, z);
      positions[at] = sx;
      positions[at + 1] = sy;
      positions[at + 2] = sz;
      const uv = (row * cols + col) * 2;

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

      indices[write++] = a; indices[write++] = b; indices[write++] = c;
      indices[write++] = b; indices[write++] = d; indices[write++] = c;
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
