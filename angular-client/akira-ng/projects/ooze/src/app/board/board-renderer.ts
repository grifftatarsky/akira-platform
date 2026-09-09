import {
  AmbientLight, BoxGeometry, CircleGeometry, Color, DirectionalLight, Group, Mesh,
  MeshLambertMaterial, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, PCFSoftShadowMap,
  RingGeometry, Scene, Vector3, WebGLRenderer,
} from 'three';
import { BoardScene, TerrainTile, TokenPlacement } from './board.models';
import { WALL_HEIGHT } from './board-scene';

/** Top-down and locked, or a camera you can orbit. */
export type CameraMode = 'TOP_DOWN' | 'PERSPECTIVE';

/**
 * Draws a {@link BoardScene} with three.
 *
 * <p><b>The scene is three-dimensional from the first frame, and only the camera
 * is locked.</b> Floors are boxes of zero height, walls are boxes eight feet
 * tall, and a token sits at its ground level plus whatever it is flying. Under
 * an orthographic camera looking straight down that reads as a flat tactical
 * board; swap in a perspective camera and the walls are already walls and the
 * balcony is already above the floor. Nothing about the data changes, which is
 * the whole of building for 3D rather than promising it.
 *
 * <p>World units are half-feet, matching the engine, so no conversion happens
 * here and no rounding decision lives in the renderer.
 *
 * <p>Deliberately not an Angular component. It owns a canvas, a render loop and
 * a pile of GPU resources, none of which belong in change detection — the
 * component drives it and disposes it, and everything here is testable only
 * against a real WebGL context, which is why the rules live in
 * {@code board-scene.ts} instead.
 */
export class BoardRenderer {

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly terrain = new Group();
  private readonly tokens = new Group();
  private camera: OrthographicCamera | PerspectiveCamera;
  private mode: CameraMode = 'TOP_DOWN';
  private frame = 0;
  private disposed = false;

  /** Half-feet of board visible across the viewport's shorter side. */
  private zoom = 200;
  private centre = new Vector3(0, 0, 0);
  private width = 1;
  private height = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.scene.add(this.terrain);
    this.scene.add(this.tokens);

    // Lit rather than unlit, even though the top-down view barely shows it. A
    // board drawn with MeshBasicMaterial looks identical from above and has
    // nothing to turn on when the camera tilts — the lights are the cheap half
    // of being ready for 3D.
    const ambient = new AmbientLight(0xffffff, 0.75);
    const sun = new DirectionalLight(0xffffff, 1.1);
    sun.position.set(-120, -200, 320);
    sun.castShadow = true;
    this.scene.add(ambient, sun);

    this.camera = this.makeCamera('TOP_DOWN');
  }

  /** Replaces everything drawn. Cheap enough at board sizes; correct always. */
  render(board: BoardScene): void {
    this.centre = new Vector3(board.widthHalfFeet / 2, board.heightHalfFeet / 2, 0);
    this.clear(this.terrain);
    this.clear(this.tokens);
    board.tiles.forEach(t => this.terrain.add(this.tile(t)));
    board.tokens.forEach(t => this.tokens.add(this.token(t)));
    this.place();
  }

  /**
   * A square of ground, as a box.
   *
   * <p>Zero-height boxes rather than planes, so a floor and a wall are the same
   * kind of object and raising one is a number rather than a different mesh.
   */
  private tile(t: TerrainTile): Mesh {
    // A hair of thickness on flat ground, so it takes shadow and never
    // z-fights whatever is drawn on it.
    const depth = t.height > 0 ? t.height : 0.5;
    const geometry = new BoxGeometry(t.size, t.size, depth);
    const material = new MeshLambertMaterial({ color: new Color(t.colour) });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(t.x, t.y, t.base + depth / 2);
    mesh.receiveShadow = true;
    mesh.castShadow = t.height > 0;
    mesh.userData = { kind: t.kind, cover: t.cover, opaque: t.opaque, light: t.light };
    return mesh;
  }

  /**
   * A creature, as a disc of its own footprint.
   *
   * <p>A disc rather than a square because a token is round on a table, and its
   * diameter is the creature's space — so a Gargantuan creature covers the
   * twenty feet it actually occupies rather than an icon's worth.
   */
  private token(t: TokenPlacement): Group {
    const group = new Group();
    const radius = t.size / 2;

    const body = new Mesh(
      new CircleGeometry(radius * 0.92, 32),
      new MeshLambertMaterial({
        color: new Color(t.colour),
        transparent: t.onDeck,
        opacity: t.onDeck ? 0.45 : 1,
      }),
    );
    body.castShadow = !t.down;
    group.add(body);

    if (t.acting) {
      // The ring is the turn marker, drawn unlit so it stays legible whatever
      // the light level does to the ground under it.
      const ring = new Mesh(
        new RingGeometry(radius * 0.95, radius * 1.12, 40),
        new MeshBasicMaterial({ color: 0xf0c674 }),
      );
      ring.position.z = 0.2;
      group.add(ring);
    }

    group.position.set(t.x, t.y, t.z);
    group.userData = { id: t.id, name: t.name, down: t.down, bloodied: t.bloodied };
    return group;
  }

  /** Switches between the locked overhead view and a camera you can orbit. */
  setCameraMode(mode: CameraMode): void {
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
    this.camera = this.makeCamera(mode);
    this.place();
  }

  cameraMode(): CameraMode {
    return this.mode;
  }

  private makeCamera(mode: CameraMode): OrthographicCamera | PerspectiveCamera {
    if (mode === 'TOP_DOWN') {
      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
      camera.up.set(0, 1, 0);
      return camera;
    }
    const camera = new PerspectiveCamera(50, 1, 1, 6000);
    // Z is up, because the engine's elevation is Z and re-basing the world to
    // three's Y-up default would put a conversion between the data and the
    // picture — the one place it must not be.
    camera.up.set(0, 0, 1);
    return camera;
  }

  /** Points the camera at the board, whichever camera it is. */
  private place(): void {
    const aspect = this.width / Math.max(1, this.height);
    if (this.camera instanceof OrthographicCamera) {
      const halfY = this.zoom / 2;
      const halfX = halfY * aspect;
      this.camera.left = -halfX;
      this.camera.right = halfX;
      this.camera.top = halfY;
      this.camera.bottom = -halfY;
      this.camera.position.set(this.centre.x, this.centre.y, 1000);
      this.camera.lookAt(this.centre);
      this.camera.updateProjectionMatrix();
      return;
    }
    this.camera.aspect = aspect;
    // Behind and above, at the angle a person leans over a table.
    this.camera.position.set(this.centre.x, this.centre.y - this.zoom * 0.9, this.zoom * 0.75);
    this.camera.lookAt(this.centre);
    this.camera.updateProjectionMatrix();
  }

  /** Half-feet visible across the viewport. Clamped so the board cannot be lost. */
  setZoom(halfFeet: number): void {
    this.zoom = Math.max(20, Math.min(2000, halfFeet));
    this.place();
  }

  zoomLevel(): number {
    return this.zoom;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.place();
  }

  start(): void {
    const loop = () => {
      if (this.disposed) {
        return;
      }
      this.renderer.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(loop);
    };
    loop();
  }

  /**
   * Gives back every GPU resource.
   *
   * <p>Geometries and materials are not garbage collected — they hold buffers
   * and programs on the device, and a board rebuilt on every state change would
   * leak them steadily until the context is lost. Which is a bug that looks like
   * "the tab got slow", hours later.
   */
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.clear(this.terrain);
    this.clear(this.tokens);
    this.renderer.dispose();
  }

  private clear(group: Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse(node => {
        if (node instanceof Mesh) {
          node.geometry.dispose();
          const material = node.material;
          if (Array.isArray(material)) {
            material.forEach(m => m.dispose());
          } else {
            material.dispose();
          }
        }
      });
    }
  }

  /** Exposed so a test can assert what was built without a WebGL context. */
  meshCounts(): { tiles: number; tokens: number } {
    return { tiles: this.terrain.children.length, tokens: this.tokens.children.length };
  }
}

/** Wall height, re-exported so a caller can size a legend without importing the scene. */
export { WALL_HEIGHT };
