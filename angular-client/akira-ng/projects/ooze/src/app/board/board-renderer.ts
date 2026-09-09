import {
  AmbientLight, BoxGeometry, CircleGeometry, Color, DirectionalLight, Group, Mesh,
  MeshLambertMaterial, MeshBasicMaterial, OrthographicCamera, PCFShadowMap, PerspectiveCamera,
  PlaneGeometry, Plane, Raycaster, RingGeometry, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { BoardScene, TerrainTile, TokenPlacement } from './board.models';
import { BoardTheme, PLAIN_THEME, pieceFor } from './board-assets';
import { LIGHT_FACTOR, WALL_HEIGHT } from './board-scene';
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
  /**
   * Furniture.
   *
   * <p>Its own group rather than part of the terrain art, because it is
   * addressed differently: terrain art is one piece per square and indexed by
   * the tile it dresses, props are a list somebody wrote. And it must never be
   * pickable — a DM dragging the rogue past a table is dragging the rogue.
   */
  private readonly props = new Group();
  /**
   * The dark, as a film over everything under it.
   *
   * <p>Its own group because it has to be laid *after* the art it covers, and
   * because the terrain group's index is the tile's index — anything else added
   * there would silently shift which box belongs to which square.
   */
  private readonly shading = new Group();
  private readonly tokens = new Group();
  private camera: OrthographicCamera | PerspectiveCamera;
  private mode: CameraMode = 'TOP_DOWN';
  /** The pending requestAnimationFrame handle, so the loop can be stopped. */
  private animation = 0;
  private disposed = false;

  /** Bumped on every render, so a model that loads late knows it is stale. */
  private generation = 0;

  /** Half-feet of board visible across the viewport's shorter side. */
  private zoom = 200;

  /**
   * A board waiting to be framed, once the viewport has a size.
   *
   * <p>Deferred rather than done on the spot: the canvas is measured by a
   * ResizeObserver, which has not fired when the first board arrives, so
   * framing then divides by a viewport of one pixel by one. Held until there is
   * a real size and then dropped, so it never fights a zoom the DM chose.
   */
  private framing: { width: number; height: number } | null = null;
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
    this.scene.add(this.props);
    this.scene.add(this.shading);
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
    this.clear(this.props);
    this.clear(this.shading);
    this.clear(this.tokens);
    board.tiles.forEach(t => {
      this.terrain.add(this.tile(t));
      const dark = this.shadeOver(t);
      if (dark) {
        this.shading.add(dark);
      }
    });
    board.tokens.forEach(t => this.tokens.add(this.token(t)));
    this.place();
    const generation = ++this.generation;
    void this.dressTerrain(board, generation);
    void this.dressProps(board, generation);
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
  private async dressTerrain(board: BoardScene, generation: number): Promise<void> {
    for (let i = 0; i < board.tiles.length; i++) {
      const tile = board.tiles[i];
      const model = await this.library.piece(
        pieceFor(tile.kind), tile.size, tile.height > 0 ? tile.height : undefined);
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
      // The box goes quiet only under a floor tile at ground level, where the
      // model covers the square exactly and the box is nothing but colour
      // underneath. It stays under a raised floor, where it is the plinth — and
      // it stays behind a wall, where it is the wall's mass: KayKit's wall is a
      // 1¼-foot-deep facing panel, so hiding the box left every corner and
      // every junction with a hole through it and rooms you could walk out of.
      // Either way the box is still in the group, so the index still means the
      // tile.
      if (box && tile.base <= 0 && tile.height === 0) {
        box.visible = false;
      }
    }
  }

  /**
   * Stands the furniture up.
   *
   * <p>Nothing is drawn for a prop the theme has no model for, unlike terrain:
   * a square with no art still has to be walked on and is drawn as a box, but a
   * barrel with no art is simply a room without a barrel in it. Which is why
   * the plain theme is an empty dungeon rather than one full of grey cubes.
   */
  private async dressProps(board: BoardScene, generation: number): Promise<void> {
    const square = board.tiles[0]?.size ?? 10;
    for (const prop of board.props) {
      const model = await this.library.piece(prop.piece, square);
      if (this.disposed || generation !== this.generation) {
        return;
      }
      if (!model) {
        continue;
      }
      model.position.set(prop.x, prop.y, prop.z);
      model.rotation.z += prop.rotation;
      this.props.add(model);
    }
  }

  /**
   * A film of dark over a square that is not brightly lit.
   *
   * <p>Only over floor: the top of a wall is not somewhere anyone stands, and
   * shading it would draw a grid of dark lids over the room walls from above.
   */
  private shadeOver(t: TerrainTile): Mesh | null {
    const factor = LIGHT_FACTOR[t.light];
    if (factor >= 1 || t.height > 0) {
      return null;
    }
    const mesh = new Mesh(new PlaneGeometry(t.size, t.size), shadeMaterial(factor));
    // Above the floor and below a token, so a creature standing in the dark is
    // still the brightest thing on its square — which is what a DM needs to
    // see, whatever the light is doing.
    mesh.position.set(t.x, t.y, t.base + 0.3);
    return mesh;
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
    // The unlit colour, because this renderer lights the scene itself — with a
    // lamp and, over anything dim, a film of dark. Using the pre-shaded colour
    // here applied the light level twice over.
    const material = new MeshLambertMaterial({ color: new Color(t.baseColour) });
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

  /**
   * Fits a whole board in view.
   *
   * <p>Both axes, against the viewport's own shape. Zooming to the longer side
   * alone opens a wide board with half the canvas empty above and below it,
   * which is what happened — a 130-foot level in a letterbox, framed as if it
   * were square.
   */
  frame(widthHalfFeet: number, heightHalfFeet: number): void {
    this.framing = { width: widthHalfFeet, height: heightHalfFeet };
    this.applyFrame();
  }

  private applyFrame(): void {
    const wanted = this.framing;
    if (!wanted || this.width <= 1 || this.height <= 1) {
      return;
    }
    const aspect = this.width / this.height;
    // `zoom` is the vertical extent, so a board wider than the viewport has to
    // be converted through the aspect before the two can be compared.
    this.setZoom(Math.max(wanted.height, wanted.width / aspect) * 1.06);
    this.framing = null;
  }

  zoomLevel(): number {
    return this.zoom;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.applyFrame();
    this.place();
  }

  start(): void {
    const loop = () => {
      if (this.disposed) {
        return;
      }
      this.renderer.render(this.scene, this.camera);
      this.animation = requestAnimationFrame(loop);
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
    cancelAnimationFrame(this.animation);
    this.clear(this.terrain);
    this.clear(this.terrainArt);
    this.clear(this.props);
    this.clear(this.shading);
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
        // Shared materials are not this node's to free. The shade quads all
        // point at one of two, and disposing them with the first board would
        // leave every later one drawing against a released program.
        if (Array.isArray(material)) {
          material.forEach(m => shared(m) || m.dispose());
        } else if (!shared(material)) {
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
  meshCounts(): { tiles: number; art: number; props: number; shaded: number; tokens: number } {
    return {
      tiles: this.terrain.children.length,
      art: this.terrainArt.children.length,
      props: this.props.children.length,
      shaded: this.shading.children.length,
      tokens: this.tokens.children.length,
    };
  }
}

/**
 * Unlit black, laid over anything not in bright light.
 *
 * <p>Module-wide, and there are only ever two, because there are only two
 * levels below bright. Tinting each tile's own material instead would mean
 * cloning a material per square — and, worse, would not touch the models, which
 * carry their own: the moment art loaded, a pitch-dark crypt would light right
 * back up. A quad over the top shades the art and the box alike.
 */
const SHADE_MATERIALS = new Map<number, MeshBasicMaterial>();

function shadeMaterial(factor: number): MeshBasicMaterial {
  let material = SHADE_MATERIALS.get(factor);
  if (!material) {
    material = new MeshBasicMaterial(
      { color: 0x000000, transparent: true, opacity: 1 - factor, depthWrite: false });
    SHADE_MATERIALS.set(factor, material);
  }
  return material;
}

/** Whether a material is one of the shared ones, and so not a mesh's to free. */
function shared(material: { uuid: string }): boolean {
  for (const m of SHADE_MATERIALS.values()) {
    if (m.uuid === material.uuid) {
      return true;
    }
  }
  return false;
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
