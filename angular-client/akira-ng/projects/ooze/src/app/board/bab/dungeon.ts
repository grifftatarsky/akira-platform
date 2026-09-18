import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect, and the third time this pattern has bitten: the container is a
// Light, but the *clustering* is a scene component, and without it every light
// in the container simply does not light anything.
import '@babylonjs/core/Lights/Clustered';
import type { BoardScene, PropKind, TerrainTile } from '../board.models';
import { FLAME_COLOR, lightSource } from '../light-rules';
import { toStage } from './terrain';

/**
 * A dungeon, lit by its own torches.
 *
 * <p><b>This is the file that deletes `light-field.ts`.</b> That was 530 lines
 * with its tests, and it existed for one reason: a forward renderer evaluates
 * every light on every fragment, so twenty torches was not a lighting rig but a
 * slideshow. The way round it was to stop having lights — bake the whole room's
 * illumination into a small image, blur it, and sample it once per pixel. It
 * worked, and everything it could not do followed from the same trick. Light
 * could not be occluded by a wall, because a texture does not know where the
 * walls are. It could not move without a re-bake. Nothing could cast a shadow
 * from a torch, because there was no torch to cast from.
 *
 * <p>Clustered lighting removes the reason. The view frustum is diced into a
 * grid of tiles and depth slices, each cluster keeps only the lights whose
 * spheres actually reach it, and a fragment evaluates that short list instead
 * of all of them. Which means these are *real* point lights: they attenuate on
 * their own, they are occluded by geometry, and a DM can drag one.
 *
 * <p>What survives from the old file is the part that was never rendering —
 * the SRD's bright and dim radii per prop, which are rules about the game.
 */

/** Half-feet a wall stands, where the tile does not say. */
const WALL_HEIGHT = 20;

export interface Dungeon {
  readonly floor: Mesh;
  readonly walls: Mesh;
  readonly torches: PointLight[];
  readonly cluster: ClusteredLightContainer | null;
  /** How many lights are live, for the stat line. */
  readonly lights: number;
  dispose(): void;
}

export function buildDungeon(board: BoardScene, scene: Scene): Dungeon {
  const floors = board.tiles.filter(tile => tile.kind !== 'WALL');
  const walls = board.tiles.filter(tile => tile.kind === 'WALL');

  const floorMesh = slab('floor', floors, scene, tile => tile.base, tile => tile.base);
  floorMesh.material = stone(scene, new Color3(0.34, 0.31, 0.28), 0.85);
  floorMesh.receiveShadows = true;

  const wallMesh = slab(
    'walls', walls, scene,
    tile => tile.base,
    tile => tile.base + (tile.height || WALL_HEIGHT),
  );
  wallMesh.material = stone(scene, new Color3(0.29, 0.27, 0.26), 0.9);
  wallMesh.receiveShadows = true;

  const flame = new Color3(FLAME_COLOR[0], FLAME_COLOR[1], FLAME_COLOR[2]);
  const torches: PointLight[] = [];
  for (const prop of board.props) {
    const source = lightSource(prop.piece as PropKind);
    if (!source) {
      continue;
    }
    const [x, y, z] = toStage(prop.x, prop.y, prop.z + 6);
    const light = new PointLight(`torch-${torches.length}`, new Vector3(x, y, z), scene);
    light.diffuse = flame;
    light.specular = flame;
    // The SRD's dim radius is where the light gives out, which is exactly what
    // a range is. Intensity is squared against it because Babylon's physical
    // falloff is inverse-square and a torch has to still read at forty feet.
    light.range = source.dim;
    // <b>The falloff has to be the default one.</b> Clustered lighting rejects
    // any other — `IsLightSupported` returns false and the light is dropped
    // from the container without a word, which presents as a room with
    // twenty-eight torches in it and one of them lit, because the stragglers
    // fall back to being ordinary lights and the material only has room for
    // four. The default is inverse-square, so the intensity is squared against
    // the SRD's bright radius: this reads as roughly full at twenty feet,
    // which is what the rule says a torch does.
    light.falloffType = PointLight.FALLOFF_DEFAULT;
    light.intensity = source.strength * source.bright * source.bright * 0.2;
    torches.push(light);
  }

  // One `Light` as far as every material is concerned, however many torches
  // are inside it — which is what lifts the four-light ceiling that made the
  // baked field necessary in the first place.
  let cluster: ClusteredLightContainer | null = null;
  if (torches.length) {
    // Not disabled first: a light inside the container is still the light
    // doing the lighting, and switching them off leaves a room with
    // twenty-eight torches in it and one of them lit.
    const container = new ClusteredLightContainer('torches', torches, scene);
    if (container.isSupported) {
      container.horizontalTiles = 16;
      container.verticalTiles = 12;
      container.depthSlices = 16;
      cluster = container;
    } else {
      // No clustering on this device: the torches stay as ordinary lights and
      // the material's four-light ceiling applies, which is the picture the
      // baked field existed to avoid. Better to see it than to hide it.
      container.dispose();
    }
  }

  return {
    floor: floorMesh,
    walls: wallMesh,
    torches,
    cluster,
    lights: torches.length,
    dispose(): void {
      floorMesh.dispose();
      wallMesh.dispose();
      cluster?.dispose();
      torches.forEach(light => light.dispose());
    },
  };
}

/**
 * Tiles as one mesh: a top face for every square, and side walls where it
 * stands proud of the floor.
 *
 * <p>One mesh rather than one per tile, because a hundred and fifty separate
 * boxes is a hundred and fifty draw calls for a room a camera sees all of at
 * once. Nothing here moves, so there is nothing to gain by keeping them apart.
 */
function slab(
  name: string, tiles: readonly TerrainTile[], scene: Scene,
  bottomOf: (tile: TerrainTile) => number,
  topOf: (tile: TerrainTile) => number,
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  const quad = (corners: [number, number, number][]) => {
    const start = positions.length / 3;
    for (const [x, y, z] of corners) {
      const [sx, sy, sz] = toStage(x, y, z);
      positions.push(sx, sy, sz);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };

  for (const tile of tiles) {
    const half = tile.size / 2;
    const x0 = tile.x - half, x1 = tile.x + half;
    const y0 = tile.y - half, y1 = tile.y + half;
    const bottom = bottomOf(tile);
    const top = topOf(tile);

    quad([[x0, y0, top], [x1, y0, top], [x1, y1, top], [x0, y1, top]]);
    if (top > bottom) {
      // Four sides. Drawn for every raised tile rather than only where one
      // meets open floor: the inside faces are hidden by the neighbour that
      // hides them, and finding out which those are costs more than the
      // triangles do.
      quad([[x0, y0, bottom], [x0, y0, top], [x0, y1, top], [x0, y1, bottom]]);
      quad([[x1, y1, bottom], [x1, y1, top], [x1, y0, top], [x1, y0, bottom]]);
      quad([[x1, y0, bottom], [x1, y0, top], [x0, y0, top], [x0, y0, bottom]]);
      quad([[x0, y1, bottom], [x0, y1, top], [x1, y1, top], [x1, y1, bottom]]);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;

  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  mesh.freezeWorldMatrix();
  return mesh;
}

function stone(scene: Scene, color: Color3, roughness: number): PBRMaterial {
  const material = new PBRMaterial('stone', scene);
  material.albedoColor = color;
  material.metallic = 0;
  material.roughness = roughness;
  material.specularIntensity = 0.2;
  // Both sides: a wall's inner faces are drawn and the winding from the axis
  // swap is not worth reasoning about per quad.
  material.backFaceCulling = false;
  return material;
}
