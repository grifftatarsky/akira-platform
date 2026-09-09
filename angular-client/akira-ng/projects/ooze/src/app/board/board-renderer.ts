import {
  AmbientLight, BoxGeometry, CircleGeometry, Color, DirectionalLight, Group, Mesh,
  MeshLambertMaterial, MeshBasicMaterial, OrthographicCamera, PCFShadowMap, PerspectiveCamera,
  Plane, Raycaster, RingGeometry, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { BoardScene, TerrainTile, TokenPlacement } from './board.models';
import { BoardTheme, PLAIN_THEME, pieceFor } from './board-assets';
import { WALL_HEIGHT } from './board-scene';
import { ModelLibrary } from './model-library';

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
  /**
   * Art laid over the terrain.
   *
   * <p>Kept apart from the boxes rather than replacing them. The boxes are the
   * structure — they carry the plinth under a raised ledge, and their index is
   * the tile's index — while models are decoration that may or may not arrive.
   * Swapping them in place meant an elevated floor lost the plinth with the box
   * and hung in the air, and it made a tile's position in the group depend on
   * what had finished loading.
   */
  private readonly terrainArt = new Group();
  private readonly tokens = new Group();
  private camera: OrthographicCamera | PerspectiveCamera;
  private mode: CameraMode = 'TOP_DOWN';
  private frame = 0;
  private disposed = false;

  /** Bumped on every render, so a model that loads late knows it is stale. */
  private generation = 0;

  /** Half-feet of board visible across the viewport's shorter side. */
  private zoom = 200;
  private centre = new Vector3(0, 0, 0);
  private width = 1;
  private height = 1;

  /** Where the camera is looking, as an offset from the board's middle. */
  private pan = new Vector3(0, 0, 0);

  /** Orbit angles, used only by the perspective camera. */
  private azimuth = 0;
  private elevation = 0.9;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  private library: ModelLibrary;
  private theme: BoardTheme;

  constructor(private readonly canvas: HTMLCanvasElement, theme: BoardTheme = PLAIN_THEME) {
    this.theme = theme;
    this.library = new ModelLibrary(theme);
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap was removed in three 0.186 and silently downgraded to
    // this with a console warning; naming it directly keeps the warning out and
    // the behaviour identical.
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene.add(this.terrain);
    this.scene.add(this.terrainArt);
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

  /**
   * Replaces everything drawn.
   *
   * <p>Boxes go down first and models replace them as they arrive, rather than
   * waiting for the pack. A board that is legible immediately and prettier a
   * moment later beats a blank rectangle that resolves all at once — and it is
   * the same code path whether the art exists or not, which is what stops the
   * no-art case from rotting.
   */
  render(board: BoardScene): void {
    this.centre = new Vector3(board.widthHalfFeet / 2, board.heightHalfFeet / 2, 0);
    this.clear(this.terrain);
    this.clear(this.terrainArt);
    this.clear(this.tokens);
    board.tiles.forEach(t => this.terrain.add(this.tile(t)));
    board.tokens.forEach(t => this.tokens.add(this.token(t)));
    this.place();
    void this.dressTerrain(board);
  }

  /** Swaps the art without touching anything else about the board. */
  setTheme(theme: BoardTheme): void {
    this.theme = theme;
    this.library = new ModelLibrary(theme);
  }

  /**
   * Replaces each tile's box with the theme's model, where it has one.
   *
   * <p>The box stays when the model is missing, which is the whole of making a
   * pack removable: delete the files and the board reverts to what it always
   * drew, with nothing to switch off.
   */
  private async dressTerrain(board: BoardScene): Promise<void> {
    const generation = ++this.generation;
    for (let i = 0; i < board.tiles.length; i++) {
      const tile = board.tiles[i];
      const model = await this.library.piece(pieceFor(tile.kind), tile.size);
      // The board may have been replaced or disposed while a model loaded; a
      // late arrival must not decorate a scene nobody is looking at.
      if (this.disposed || generation !== this.generation) {
        return;
      }
      if (!model) {
        continue;
      }
      const box = this.terrain.children[i];
      model.position.set(tile.x, tile.y, tile.base);
      model.rotation.z += tile.rotation;
      this.terrainArt.add(model);
      // The box stays when it is holding a raised floor up; otherwise it is
      // just colour under the art and can go quiet. Either way it is still
      // there, so the index still means the tile.
      if (box && tile.base <= 0) {
        box.visible = false;
      }
    }
  }

  /**
   * A square of ground, as a box.
   *
   * <p>Zero-height boxes rather than planes, so a floor and a wall are the same
   * kind of object and raising one is a number rather than a different mesh.
   */
  private tile(t: TerrainTile): Mesh {
    // Walls stand up from their base; floors sit on a plinth reaching down to
    // ground level. Without the plinth a raised ledge floats with nothing under
    // it — the walkable surface is at the right height either way, but a DM
    // reading the picture sees a bug rather than a ledge.
    const wall = t.height > 0;
    const depth = wall ? t.height : Math.max(0.5, t.base);
    const geometry = new BoxGeometry(t.size, t.size, depth);
    const material = new MeshLambertMaterial({ color: new Color(t.colour) });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(t.x, t.y, wall ? t.base + depth / 2 : t.base - depth / 2);
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
      const target = new Vector3().addVectors(this.centre, this.pan);
      this.camera.position.set(target.x, target.y, 1000);
      this.camera.lookAt(target);
      this.camera.updateProjectionMatrix();
      return;
    }
    this.camera.aspect = aspect;
    // Spherical around the look-at point, so orbiting keeps the board centred
    // rather than swinging it out of frame.
    const target = new Vector3().addVectors(this.centre, this.pan);
    const radius = this.zoom * 1.2;
    this.camera.position.set(
      target.x + radius * Math.cos(this.elevation) * Math.sin(this.azimuth),
      target.y - radius * Math.cos(this.elevation) * Math.cos(this.azimuth),
      target.z + radius * Math.sin(this.elevation),
    );
    this.camera.lookAt(target);
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
    this.clear(this.terrainArt);
    this.clear(this.tokens);
    this.renderer.dispose();
  }

  private clear(group: Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      this.disposeNode(child);
    }
  }

  private disposeNode(node: import('three').Object3D): void {
    node.traverse(child => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) {
          material.forEach(m => m.dispose());
        } else {
          material.dispose();
        }
      }
    });
  }

  // region Picking and camera control

  /**
   * The token under a screen pixel, or null.
   *
   * <p>Raycasting rather than projecting token centres and comparing distances,
   * because a token is a disc of its creature's footprint and a Gargantuan one
   * is four times the width of a Medium: "nearest centre" would let a click on
   * the tarrasque's flank select the knight standing behind it.
   */
  pickToken(screenX: number, screenY: number): string | null {
    this.aim(screenX, screenY);
    const hits = this.raycaster.intersectObjects(this.tokens.children, true);
    for (const hit of hits) {
      // The disc is a child of the token group, so walk up to whatever carries
      // the id.
      let node: import('three').Object3D | null = hit.object;
      while (node && !node.userData?.['id']) {
        node = node.parent;
      }
      if (node) {
        return node.userData['id'] as string;
      }
    }
    return null;
  }

  /**
   * Where a screen pixel lands on the ground, in half-feet.
   *
   * <p>Against the z = 0 plane rather than against the terrain, deliberately.
   * Dropping a token onto the *visible* top of a wall would put it eight feet up
   * on a surface nothing can stand on; the board's coordinates are ground
   * coordinates, and elevation comes from the cell underneath.
   */
  groundAt(screenX: number, screenY: number): { x: number; y: number } | null {
    this.aim(screenX, screenY);
    const target = new Vector3();
    const hit = this.raycaster.ray.intersectPlane(GROUND, target);
    return hit ? { x: target.x, y: target.y } : null;
  }

  private aim(screenX: number, screenY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /**
   * Pans by a drag, in screen pixels.
   *
   * <p>Converted through the current zoom so a drag moves the board under the
   * pointer by the same amount however far out the camera is — anything else
   * feels like the board is on ice.
   */
  panBy(dxPixels: number, dyPixels: number): void {
    const perPixel = this.zoom / Math.max(1, this.height);
    this.pan.x -= dxPixels * perPixel;
    this.pan.y += dyPixels * perPixel;
    this.place();
  }

  /** Orbits, for the perspective camera. Ignored while the view is locked overhead. */
  orbitBy(dxPixels: number, dyPixels: number): void {
    if (this.mode !== 'PERSPECTIVE') {
      return;
    }
    this.azimuth -= dxPixels * 0.005;
    // Clamped short of straight down and short of the horizon: past either the
    // board becomes unreadable and the camera feels broken rather than free.
    this.elevation = Math.max(0.15, Math.min(1.45, this.elevation - dyPixels * 0.005));
    this.place();
  }

  /** Puts the camera back over the middle of the board. */
  recentre(): void {
    this.pan.set(0, 0, 0);
    this.place();
  }

  // endregion

  /** Exposed so a test can assert what was built without a WebGL context. */
  meshCounts(): { tiles: number; art: number; tokens: number } {
    return {
      tiles: this.terrain.children.length,
      art: this.terrainArt.children.length,
      tokens: this.tokens.children.length,
    };
  }
}

/**
 * The ground.
 *
 * <p>Constructed once: a Plane is immutable here and allocating one per pointer
 * move would churn the heap on the hottest path the board has.
 */
const GROUND = new Plane(new Vector3(0, 0, 1), 0);

/** Wall height, re-exported so a caller can size a legend without importing the scene. */
export { WALL_HEIGHT };
