import {
  Box3, BufferGeometry, InstancedMesh, Material, Matrix4, Mesh, Object3D, Quaternion, Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SplatGround } from './board-assets';
import { BoardScene } from './board.models';
import { GroundField, groundAt } from './ground-field';
import { ScatterKind, Scattered, scatter } from './scatter';

/**
 * Draws the things lying on the ground.
 *
 * <p>One instanced mesh per kind, so a thousand tufts of grass are one draw
 * call. Which is the whole reason a thousand is affordable, and a thousand is
 * roughly what it takes: scatter is a numbers game, and a dozen carefully
 * placed rocks read as a dozen carefully placed rocks.
 *
 * <p>Every piece sits on the ground *as the ground actually is* — sunk by the
 * same rut depth the vertex shader applies to the surface, from the same wear
 * field. Placing them on the flat plane instead leaves stones hovering over
 * the middle of the road, which is the one place stones are most likely to be.
 */

/** Matches `RUT_DEPTH` in the ground; the same sink, applied on the CPU. */
const RUT_DEPTH = 0.9;

export interface ScatterLayer {
  readonly meshes: readonly InstancedMesh[];
  dispose(): void;
}

export async function scatterGround(
  ground: SplatGround,
  board: BoardScene,
  field: GroundField,
  light: (material: Material) => Material,
): Promise<ScatterLayer> {
  const placed = scatter(board, field);
  const byKind = new Map<ScatterKind, Scattered[]>();
  for (const item of placed) {
    const bucket = byKind.get(item.kind);
    if (bucket) {
      bucket.push(item);
    } else {
      byKind.set(item.kind, [item]);
    }
  }

  const loader = new GLTFLoader();
  const meshes: InstancedMesh[] = [];
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const quaternion = new Quaternion();
  const up = new Vector3(0, 0, 1);

  for (const [kind, items] of byKind) {
    const url = ground.scatter?.[kind];
    if (!url) {
      continue;
    }
    const shape = await flatten(loader, url);
    if (!shape) {
      continue;
    }
    const mesh = new InstancedMesh(shape.geometry, light(shape.material), items.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    items.forEach((item, slot) => {
      const { wear } = groundAt(field, item.x, item.y);
      position.set(item.x, item.y, -wear * wear * RUT_DEPTH);
      quaternion.setFromAxisAngle(up, item.turn);
      scale.setScalar(item.scale * shape.fit);
      mesh.setMatrixAt(slot, matrix.compose(position, quaternion, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    meshes.push(mesh);
  }

  return {
    meshes,
    dispose() {
      meshes.forEach(mesh => {
        mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) {
          material.forEach(m => m.dispose());
        } else {
          material.dispose();
        }
      });
    },
  };
}

/**
 * One model, flattened to a geometry and sized to this world.
 *
 * <p>Poly Haven's models are in metres and Z-up already, which is this world's
 * orientation but not its unit — so the only conversion is a scale, and it is
 * measured off the model rather than assumed. A tuft of grass that came out
 * five feet across would be a very different plant.
 */
async function flatten(
  loader: GLTFLoader,
  url: string,
): Promise<{ geometry: BufferGeometry; material: Material; fit: number } | null> {
  const gltf = await loader.loadAsync(new URL(url, import.meta.url).href)
    .catch(() => null);
  if (!gltf) {
    console.warn('[board] no scatter model at %s — leaving the ground bare', url);
    return null;
  }
  const scene = gltf.scene as Object3D;
  scene.updateMatrixWorld(true);

  const parts: BufferGeometry[] = [];
  let material: Material | null = null;
  scene.traverse(node => {
    if (!(node instanceof Mesh)) {
      return;
    }
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(node.matrixWorld);
    parts.push(geometry);
    material ??= Array.isArray(node.material) ? node.material[0] : node.material;
  });
  if (parts.length === 0 || !material) {
    return null;
  }
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (!geometry) {
    return null;
  }
  if (geometry !== parts[0]) {
    parts.forEach(part => part.dispose());
  }

  // glTF is Y-up, always, by specification — including these, which I had
  // assumed were already Z-up because Poly Haven authors in Blender. They are
  // not, and unrotated a pile of fallen branches stands four feet in the air on
  // one end. One quarter turn, the same one the dungeon's loader applies.
  geometry.rotateX(Math.PI / 2);

  // Then centred on its own footprint and sat on the ground, because a model
  // whose origin the artist left somewhere else would otherwise float or sink
  // by however far that was.
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new Box3();
  geometry.translate(
    -(box.min.x + box.max.x) / 2,
    -(box.min.y + box.max.y) / 2,
    -box.min.z);
  // Poly Haven models are in metres; this world is in half-feet, so one metre
  // is 6.5617 of them. Not a fudge factor — a unit conversion, and the only
  // one, because the models are already Z-up like the board.
  return { geometry, material, fit: 6.5617 };
}
