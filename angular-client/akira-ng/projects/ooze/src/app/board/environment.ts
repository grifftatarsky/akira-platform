import { EquirectangularReflectionMapping, PMREMGenerator, Texture, WebGLRenderer } from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BoardTheme } from './board-assets';

/**
 * Where the light in the room comes from when nothing in the room is making it.
 *
 * <p><b>This is the single biggest reason the board looked like clay.</b> Every
 * piece in the pack is a `MeshStandardMaterial` — metalness 0, roughness 0.45 —
 * and a physically-based material with no environment gets no ambient specular
 * at all and no directional ambient. One flat ambient term plus one sun is
 * exactly the light you would use to photograph plasticine. An environment map
 * gives the material a whole sky to reflect: brighter above than below, warm
 * where the stone is warm, with a soft sheen across every curved surface.
 *
 * <p>Convolved rather than drawn. {@link PMREMGenerator} pre-filters the image
 * into the mip chain a roughness lookup needs, and the result is never used as a
 * backdrop — a dungeon seen from above has no sky in shot. That is also why 1k
 * is plenty: nothing here is mirror-smooth, so nothing can show detail the
 * convolution has already thrown away, and the same file at 8k is 98 MB.
 *
 * <p>Missing is a normal outcome, like a missing model. A theme that names no
 * environment, or names one that is not there, falls back to three's
 * {@link RoomEnvironment} — a box of emissive panels that is a worse dungeon and
 * a perfectly good light. The board is never unlit, and deleting the `hdri`
 * directory is a supported thing to do.
 */
export class EnvironmentLibrary {

  private readonly pmrem: PMREMGenerator;
  private readonly cache = new Map<string, Promise<Texture | null>>();
  private room: Texture | null = null;

  constructor(private readonly renderer: WebGLRenderer) {
    this.pmrem = new PMREMGenerator(renderer);
    // Warms the shader that does the convolution, so the first environment does
    // not compile it on the frame it is needed.
    this.pmrem.compileEquirectangularShader();
  }

  /** The theme's environment, or the fallback room if it has none or it fails. */
  async forTheme(theme: BoardTheme): Promise<Texture> {
    const url = theme.environment?.url;
    if (url) {
      const loaded = await this.load(url);
      if (loaded) {
        return loaded;
      }
    }
    return this.fallback();
  }

  /**
   * Three's own room, convolved once and kept.
   *
   * <p>Generated rather than shipped, so it costs nothing to download and
   * cannot go missing. It reads as a photographer's studio rather than a
   * cellar, which is the point of preferring a real capture — but a studio is
   * an enormous improvement on nothing.
   */
  private fallback(): Texture {
    if (!this.room) {
      this.room = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }
    return this.room;
  }

  private load(url: string): Promise<Texture | null> {
    const cached = this.cache.get(url);
    if (cached) {
      return cached;
    }
    const pending = new Promise<Texture | null>(resolve => {
      // Resolved against this module and not the document, for the reason every
      // asset here is: served standalone the board is at `/` and inside the host
      // it is at `/ooze/`, and nginx answers a miss with index.html at 200
      // rather than a 404 — so a wrong path arrives as HTML and fails somewhere
      // far away from the mistake.
      const resolved = new URL(url, import.meta.url).href;
      new RGBELoader().load(
        resolved,
        source => {
          source.mapping = EquirectangularReflectionMapping;
          const convolved = this.pmrem.fromEquirectangular(source).texture;
          // The source is 1024x512 of float data on the device and the mip
          // chain no longer refers to it. Keeping it is four megabytes of
          // nothing.
          source.dispose();
          resolve(convolved);
        },
        undefined,
        error => {
          console.warn('[board] no environment at %s — falling back to a plain room',
            resolved, error);
          resolve(null);
        },
      );
    });
    this.cache.set(url, pending);
    return pending;
  }

  dispose(): void {
    this.pmrem.dispose();
    this.room?.dispose();
    void Promise.all([...this.cache.values()]).then(all =>
      all.forEach(t => t?.dispose()));
  }
}
