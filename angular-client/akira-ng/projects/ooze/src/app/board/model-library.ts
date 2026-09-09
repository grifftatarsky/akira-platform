import { Box3, Group, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BoardPiece, BoardTheme, modelFor } from './board-assets';

/**
 * Loads a theme's models once and hands out copies.
 *
 * <p><b>Failure is a normal outcome here.</b> A theme names files that may
 * simply not be there — somebody deleted a pack, swapped in their own, or is
 * running before the assets were fetched — and the board has to keep working. A
 * miss resolves to null rather than rejecting, and the renderer draws its
 * coloured box. That is what makes the art removable rather than load-bearing.
 *
 * <p>Loaded once and cloned per instance: a forty-by-forty board is 1 600
 * squares, and parsing one floor tile that many times would be slow and would
 * hold 1 600 copies of the same geometry on the device.
 */
export class ModelLibrary {

  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<Object3D | null>>();

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
