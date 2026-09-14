import { Box3, BufferGeometry, Group, Material, Mesh, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BoardPiece, BoardTheme, modelFor } from './board-assets';

/**
 * One piece, flattened into something an {@code InstancedMesh} can draw.
 *
 * <p>Shared and owned by the library, unlike the copies {@link
 * ModelLibrary#piece} hands out — a renderer that disposed one of these would
 * take every future barrel with it.
 */
export interface InstancedPiece {
  readonly geometry: BufferGeometry;
  readonly material: Material | Material[];
}

/**
 * Loads a theme's models once and hands out copies.
 *
 * <p><b>Failure is a normal outcome here.</b> A theme names files that may
 * simply not be there — somebody deleted a pack, swapped in their own, or is
 * running before the assets were fetched — and the board has to keep working. A
 * miss resolves to null rather than rejecting, and the renderer draws its
 * colored box. That is what makes the art removable rather than load-bearing.
 *
 * <p>Loaded once and cloned per instance: a forty-by-forty board is 1 600
 * squares, and parsing one floor tile that many times would be slow and would
 * hold 1 600 copies of the same geometry on the device.
 */
export class ModelLibrary {

  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<Object3D | null>>();
  private readonly flattened = new Map<string, Promise<InstancedPiece | null>>();

  constructor(private readonly theme: BoardTheme) {}

  /**
   * A copy of the model for a piece, ready to place, or null if there is none.
   *
   * <p>The copy is normalised so it occupies the footprint the board asked for,
   * whatever the pack was authored at, and its origin is moved to the centre of
   * that footprint at ground level — because that is where the board puts
   * things, and a pack that disagreed would otherwise need a per-piece offset
   * nobody could derive by looking.
   *
   * @param squareHalfFeet how wide the piece should end up, before its own scale
   * @param heightHalfFeet how tall it must be, where the board has an opinion
   */
  async piece(
    piece: BoardPiece | null,
    squareHalfFeet: number,
    heightHalfFeet?: number,
  ): Promise<Object3D | null> {
    const model = modelFor(this.theme, piece);
    if (!model) {
      return null;
    }
    const source = await this.load(model.url);
    if (!source) {
      return null;
    }
    const copy = source.clone(true);

    // glTF is Y-up and this world is Z-up, because the engine's elevation is Z
    // and re-basing the world would put a conversion between the data and the
    // picture. So the conversion lives here instead — once, in the loader —
    // and every pack gets it for free.
    //
    // Without it a floor tile stands on its edge: KayKit's is 4x4 units across
    // and 0.15 thick, and unrotated that thickness becomes its footprint. The
    // board draws as pale vertical strips with gaps between them, which looks
    // like a scaling bug and is not one.
    const upright = new Group();
    upright.rotation.x = Math.PI / 2;
    upright.add(copy);

    const holder = new Group();
    holder.add(upright);

    // Measured rather than assumed, and measured *after* the rotation. A pack
    // states a nominal scale and its pieces still vary — a wall is not a floor
    // tile — so each is fitted to the square it has to occupy, and the theme's
    // number is the fallback for anything that measures to nothing.
    const box = new Box3().setFromObject(upright);
    const size = new Vector3();
    box.getSize(size);
    // The footprint is X and Y now that the model is upright; Z is height and
    // must not drive the fit, or a wall would be scaled down by how tall it is.
    const widest = Math.max(size.x, size.y);
    const scale = widest > 0
      ? (squareHalfFeet / widest) * (model.scale ?? 1)
      : this.theme.unitsPerModelUnit * (model.scale ?? 1);
    upright.scale.setScalar(scale);

    // Stretched to the height the board declares, where it declares one.
    //
    // Measured: KayKit's wall is 4.00 units wide and 4.00 tall, i.e. exactly as
    // tall as a tile is wide — the pack is drawn for 10-foot tiles. Fitted to a
    // 5-foot D&D square it comes out a 5-foot wall, which is a wall you can see
    // over and shoot across, and the engine has already decided you cannot. The
    // art has to follow the rule rather than the other way round, so it is
    // stretched on the up axis alone; on stone that reads as taller courses,
    // and a 5-foot wall reads as a bug.
    //
    // Scale is applied in the object's own frame and `upright` is the thing
    // carrying the quarter-turn, so the axis to stretch is its *local Y* — the
    // one the rotation sends to world Z. Stretching local Z here would widen
    // the piece north-south and leave it exactly as short as it was.
    const height = heightHalfFeet ?? model.heightHalfFeet;
    if (height && size.z > 0) {
      upright.scale.y = height / size.z;
    }

    // Re-measure after scaling, then sit it on the ground centred on its own
    // footprint — glTF origins are wherever the artist left them, and KayKit's
    // tiles hang slightly below theirs.
    const scaled = new Box3().setFromObject(upright);
    const centre = new Vector3();
    scaled.getCenter(centre);
    upright.position.x -= centre.x;
    upright.position.y -= centre.y;
    upright.position.z -= scaled.min.z;
    upright.position.z += model.lift ?? 0;

    if (model.rotation) {
      holder.rotation.z = model.rotation;
    }
    holder.traverse(node => {
      node.castShadow = true;
      node.receiveShadow = true;
    });
    return holder;
  }

  /**
   * The same piece, as one geometry and one material, ready to instance.
   *
   * <p>A furnished level is 520 floor tiles and a hundred props, and drawn one
   * object at a time that is over a thousand draw calls before the shadow and
   * occlusion passes double it. Every piece of a given kind is identical, so
   * they can be one call each — which is what this exists for.
   *
   * <p><b>Built by flattening what {@link ModelLibrary#piece} already
   * produces</b>, rather than by re-deriving the fit. That fit is delicate —
   * the Y-up rotation, the measure-fit-remeasure, the height stretch on the
   * rotated node's local axis — and every one of those was got wrong once
   * already. Baking the group's own world matrices into the geometry cannot
   * disagree with it, because it *is* it.
   *
   * <p>Cached per shape, since two calls for the same piece at the same size
   * would otherwise be two copies of the same buffer on the device.
   */
  async instanced(
    piece: BoardPiece | null,
    squareHalfFeet: number,
    heightHalfFeet?: number,
  ): Promise<InstancedPiece | null> {
    if (!piece) {
      return null;
    }
    const key = `${piece}|${squareHalfFeet}|${heightHalfFeet ?? ''}`;
    const cached = this.flattened.get(key);
    if (cached) {
      return cached;
    }
    const pending = this.flatten(piece, squareHalfFeet, heightHalfFeet);
    this.flattened.set(key, pending);
    return pending;
  }

  private async flatten(
    piece: BoardPiece,
    squareHalfFeet: number,
    heightHalfFeet?: number,
  ): Promise<InstancedPiece | null> {
    const group = await this.piece(piece, squareHalfFeet, heightHalfFeet);
    if (!group) {
      return null;
    }
    // The fit lives in the wrapper nodes' transforms, not in the geometry, so
    // the matrices have to be resolved before they can be baked.
    group.updateMatrixWorld(true);

    const parts: BufferGeometry[] = [];
    const materials: Material[] = [];
    group.traverse(node => {
      if (!(node instanceof Mesh)) {
        return;
      }
      const geometry = node.geometry.clone();
      geometry.applyMatrix4(node.matrixWorld);
      parts.push(geometry);
      materials.push(Array.isArray(node.material) ? node.material[0] : node.material);
    });

    if (parts.length === 0) {
      return null;
    }
    // Every KayKit piece is a single mesh with a single material off one
    // atlas, which is the case worth being fast. A pack that is not gets
    // merged with groups instead and costs a draw call per material — still
    // once per *kind* rather than once per barrel.
    const oneMaterial = materials.every(m => m === materials[0]);
    const merged = parts.length === 1
      ? parts[0]
      : mergeGeometries(parts, !oneMaterial);
    if (!merged) {
      // Mismatched attributes between a model's own meshes. Rare, and not
      // worth a second code path: the board draws its colored box instead,
      // which is the same thing a missing file does.
      console.warn('[board] %s could not be merged for instancing — drawing a plain tile', piece);
      parts.forEach(g => g.dispose());
      return null;
    }
    if (merged !== parts[0]) {
      parts.forEach(g => g.dispose());
    }
    // Marked so a renderer clearing its scene leaves them alone. These belong
    // to the library and outlive any one board.
    merged.userData['shared'] = true;
    materials.forEach(m => (m.userData['shared'] = true));
    return { geometry: merged, material: oneMaterial ? materials[0] : materials };
  }

  /**
   * Frees everything the library owns.
   *
   * <p>Needed because {@link ModelLibrary#instanced} hands out shared buffers
   * rather than copies: nothing else is in a position to free them, and a
   * theme swap makes a whole library garbage at once.
   */
  dispose(): void {
    void Promise.all([...this.flattened.values()]).then(all => all.forEach(piece => {
      piece?.geometry.dispose();
      const material = piece?.material;
      if (Array.isArray(material)) {
        material.forEach(m => m.dispose());
      } else {
        material?.dispose();
      }
    }));
    this.flattened.clear();
    this.cache.clear();
  }

  /**
   * Warms the cache.
   *
   * <p>Worth doing before the first frame: without it the board pops in tile by
   * tile as promises land, which reads as broken rather than as loading.
   */
  async preload(): Promise<void> {
    await Promise.all(
      Object.keys(this.theme.pieces).map(k => this.piece(k as BoardPiece, 10)));
  }

  /**
   * Resolves an asset path against this module, not the document.
   *
   * <p>Ooze is a federation remote. Served on its own the board is at `/board`
   * and its assets at `/assets/...`; inside the host it is at `/ooze/board` and
   * its assets are at `/remotes/ooze/assets/...`. A relative path is right in
   * one shell and wrong in the other.
   *
   * <p>Worse than wrong: nginx serves the host's `index.html` as an SPA
   * fallback, so the miss came back **200 with `text/html`** rather than 404.
   * The loader parsed HTML, failed, and the board quietly drew boxes — the
   * fallback working perfectly for entirely the wrong reason.
   *
   * <p>`import.meta.url` points at the chunk this code was loaded from, which is
   * under the remote's own base in both shells. The same technique the globe
   * uses for maplibre's worker, and for the same reason.
   */
  private resolve(url: string): string {
    try {
      return new URL(url, import.meta.url).href;
    } catch {
      return url;
    }
  }

  private load(url: string): Promise<Object3D | null> {
    const cached = this.cache.get(url);
    if (cached) {
      return cached;
    }
    const pending = new Promise<Object3D | null>(resolve => {
      const resolved = this.resolve(url);
      this.loader.load(
        resolved,
        gltf => resolve(gltf.scene),
        undefined,
        // A missing model is a board without art, not a board that fails to
        // draw — but it is said out loud. Silence here hid a path bug behind a
        // fallback that was working as designed, and "the art just never
        // appears" is not a debuggable symptom.
        error => {
          console.warn('[board] no model at %s — drawing a plain tile instead',
            resolved, error);
          resolve(null);
        },
      );
    });
    this.cache.set(url, pending);
    return pending;
  }

  /** Whether anything actually loaded, so the UI can say the pack is missing. */
  async anyLoaded(): Promise<boolean> {
    const results = await Promise.all([...this.cache.values()]);
    return results.some(r => r !== null);
  }
}
