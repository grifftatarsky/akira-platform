import {
  AmbientLight, BoxGeometry, CircleGeometry, Color, DirectionalLight, Group, Mesh,
  DataTexture, LinearFilter, Material, MeshBasicMaterial, NeutralToneMapping, MeshStandardMaterial,
  Object3D, OrthographicCamera, PCFShadowMap, PerspectiveCamera, Plane, Raycaster, RGBAFormat,
  RingGeometry, Scene, ClampToEdgeWrapping, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { BoardScene, TerrainTile, TokenPlacement } from './board.models';
import { BoardTheme, PLAIN_THEME, pieceFor } from './board-assets';
import { WALL_HEIGHT } from './board-scene';
import { ModelLibrary } from './model-library';
import { EnvironmentLibrary } from './environment';
import { LIGHT_RANGE, lightField } from './light-field';

/** Top-down and locked, or a camera you can orbit. */
export type CameraMode = 'TOP_DOWN' | 'PERSPECTIVE';

/**
 * How far the structural boxes sit inside the art laid over them, in half-feet.
 *
 * <p>Two surfaces at exactly the same depth are a coin toss per pixel, and the
 * toss is re-thrown every time the camera moves — which is what a board that
 * shimmers while you pan actually is. A wall's box top and its facing panel's
 * top were both at 8 feet, and a raised floor's plinth top and the tile sitting
 * on it were both at the ledge height, so most of the board was doing it.
 *
 * <p>An inch and a bit. Enough to separate them at every zoom the camera
 * clamps to, small enough that the step it leaves is invisible.
 */
const ART_CLEARANCE = 0.2;

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

  /**
   * The one shadow-casting light, aimed at whatever board is loaded.
   *
   * <p>Held rather than made and forgotten, because a directional light's
   * shadow frustum does not follow the scene. Its default is ten units square
   * around the world origin: on a 130-foot level that covers one square, aimed
   * at a corner nothing stands in, so nothing cast a shadow and what did fell
   * outside the map and shimmered.
   */
  private readonly sun = new DirectionalLight(0xffffff, 1.1);

  /**
   * The board's light, shared by every material that answers to it.
   *
   * <p>One object handed to every patched shader, so replacing the texture on a
   * new board updates all of them at once rather than four hundred times.
   */
  private readonly light: { value: DataTexture | null } = { value: null };
  private readonly extent = { value: new Vector2(1, 1) };

  /**
   * Materials already patched.
   *
   * <p>Weak, and needed: a cloned model shares its source's material, so a room
   * with thirty barrels hands the same material back thirty times, and patching
   * a shader twice injects the sample twice — which squares the light and turns
   * a torch into a floodlight.
   */
  private readonly patched = new WeakSet<Material>();

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  private library: ModelLibrary;
  private readonly environments: EnvironmentLibrary;
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

    // Khronos PBR Neutral rather than ACES.
    //
    // Both roll highlights off instead of clipping them, which is the point of
    // tone mapping at all. ACES also desaturates hard as it does it — it is a
    // film emulation, and film does that — and this board is painted rather
    // than photographed: torchlight that goes cream at the centre of the pool
    // is exactly the look we are aiming away from. Neutral keeps the hue and
    // only compresses the level.
    this.renderer.toneMapping = NeutralToneMapping;
    // Slightly under one, so a torch has headroom to be the brightest thing on
    // the board rather than one more surface at full white.
    this.renderer.toneMappingExposure = 0.95;

    this.environments = new EnvironmentLibrary(this.renderer);
    void this.lightScene(theme);

    this.scene.add(this.terrain);
    this.scene.add(this.terrainArt);
    this.scene.add(this.props);
    this.scene.add(this.tokens);

    // A trace of flat fill, and no more. The ambient term used to be 0.75 and
    // was doing the job an environment map does properly — flatly, from every
    // direction at once, which is why nothing on the board had a lit side and a
    // shaded side. Now the environment carries the ambient and this only keeps
    // the deepest corners off pure black.
    this.scene.add(new AmbientLight(0xffffff, 0.08));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // Offset along the surface normal rather than in depth. Plain `bias` on a
    // frustum this wide has to be large enough to detach a shadow from the
    // thing casting it; normalBias solves the same acne without the gap.
    this.sun.shadow.normalBias = 0.4;
    // The target has to be in the scene or the light ignores where it points —
    // three reads the target's *world* matrix, and an orphan never gets one.
    this.scene.add(this.sun, this.sun.target);

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
    this.clear(this.tokens);
    this.relight(board);
    board.tiles.forEach(t => this.terrain.add(this.tile(t)));
    board.tokens.forEach(t => this.tokens.add(this.token(t)));
    this.aimSun(board);
    this.place();
    const generation = ++this.generation;
    void this.dressTerrain(board, generation);
    void this.dressProps(board, generation);
  }

  /**
   * Points the sun at the board and sizes its shadow to fit.
   *
   * <p>Both are per-board: the frustum has to contain everything that casts,
   * and a frustum much bigger than that spends its texels on empty space and
   * gives blocky shadows. Sized to the board, a 2048 map is about an inch per
   * texel on a level this size.
   */
  private aimSun(board: BoardScene): void {
    const cx = board.widthHalfFeet / 2;
    const cy = board.heightHalfFeet / 2;
    const span = Math.max(board.widthHalfFeet, board.heightHalfFeet, 20);
    this.sun.target.position.set(cx, cy, 0);
    // High — about 70° — and from the north-west. Low light gives a prettier
    // perspective view and ruins the top-down one: an 8-foot wall lit from 45°
    // throws 8 feet of shadow, which is a whole square a DM has to work out is
    // not difficult terrain. At this angle a wall's shadow is under half its
    // height, enough to read as depth and not enough to read as ground.
    this.sun.position.set(cx - span * 0.28, cy - span * 0.4, span * 1.2);
    const shadow = this.sun.shadow.camera;
    const half = span * 0.8;
    shadow.left = -half;
    shadow.right = half;
    shadow.top = half;
    shadow.bottom = -half;
    shadow.near = 1;
    shadow.far = span * 3;
    shadow.updateProjectionMatrix();
  }

  /** Swaps the art without touching anything else about the board. */
  setTheme(theme: BoardTheme): void {
    if (theme.id === this.theme.id) {
      return;
    }
    this.theme = theme;
    this.library = new ModelLibrary(theme);
    void this.lightScene(theme);
  }

  /**
   * Hands the scene the theme's environment.
   *
   * <p>Asynchronous and unawaited: the board draws immediately under the sun
   * alone and gains its ambient a moment later, the same way it draws boxes
   * before the models arrive. A blank rectangle that resolves all at once is
   * worse than a plain one that improves.
   */
  private async lightScene(theme: BoardTheme): Promise<void> {
    const map = await this.environments.forTheme(theme);
    if (this.disposed || this.theme.id !== theme.id) {
      return;
    }
    this.scene.environment = map;
    this.scene.environmentIntensity = theme.environment?.intensity ?? 1;
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
      this.terrainArt.add(this.litTree(model));
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
      this.props.add(this.litTree(model));
    }
  }

  /**
   * Rebuilds the board's light and hands it to every shader.
   *
   * <p>Cheap enough to do on every render — a whole level is 104 by 80 texels
   * and a millisecond of arithmetic — so there is no cache to invalidate and no
   * way for the light to disagree with the board it is lighting.
   */
  private relight(board: BoardScene): void {
    const field = lightField(board);
    this.light.value?.dispose();
    const texture = new DataTexture(field.data, field.width, field.height, RGBAFormat);
    // Linear, which is what turns 104 by 80 texels into a smooth gradient
    // across a 130-foot room: the hardware interpolates between them for free
    // and the field never has to be stored at the resolution it is seen at.
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    // Clamped, so a surface a hair past the edge of the board samples the edge
    // rather than wrapping round to the far corner of the map.
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    this.light.value = texture;
    this.extent.value.set(field.extentXHalfFeet, field.extentYHalfFeet);
  }

  /**
   * Makes a material answer to the board's light.
   *
   * <p>An injection into three's own shader rather than a material of our own,
   * because the alternative is reimplementing physically-based shading to add
   * one multiply — and losing the environment map, the shadows and every future
   * three release along with it.
   *
   * <p><b>The multiply lands before tone mapping, not after.</b> Three's last
   * chunk is the obvious hook and the wrong one: by then the colour has been
   * through the tone curve and encoded to sRGB, so scaling it there darkens a
   * display value rather than reducing an amount of light, and a torch could
   * never be brighter than white. Injected ahead of `tonemapping_fragment` the
   * light is still linear radiance, so a pool over 1.0 rolls off into a warm
   * highlight the way a flame should.
   */
  private lit<T extends Material>(material: T): T {
    if (this.patched.has(material)) {
      return material;
    }
    this.patched.add(material);
    material.onBeforeCompile = shader => {
      shader.uniforms['uBoardLight'] = this.light;
      shader.uniforms['uBoardExtent'] = this.extent;
      shader.vertexShader = 'varying vec3 vBoardPos;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vBoardPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader =
        'varying vec3 vBoardPos;\nuniform sampler2D uBoardLight;\nuniform vec2 uBoardExtent;\n'
        + shader.fragmentShader.replace(
          '#include <tonemapping_fragment>',
          `gl_FragColor.rgb *= texture2D(uBoardLight, vBoardPos.xy / uBoardExtent).rgb
             * ${LIGHT_RANGE.toFixed(1)};
           #include <tonemapping_fragment>`);
    };
    // Without this three reuses a cached program compiled from an identical
    // material that was never patched, and the injection silently does nothing
    // for every material after the first.
    material.customProgramCacheKey = () => 'board-light';
    return material;
  }

  /** Makes every material under a node answer to the board's light. */
  private litTree(node: Object3D): Object3D {
    node.traverse(child => {
      if (child instanceof Mesh) {
        const material = child.material;
        if (Array.isArray(material)) {
          material.forEach(m => this.lit(m));
        } else {
          this.lit(material);
        }
      }
    });
    return node;
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
    // A hair shorter than the art it backs, always. The box is structure — the
    // mass behind a wall's facing panel, the plinth under a raised floor — and
    // a structure whose top surface is exactly level with the art's is a
    // z-fight across the whole board.
    const wall = t.height > 0;
    const depth = Math.max(0.2, (wall ? t.height : Math.max(0.5, t.base)) - ART_CLEARANCE);
    const geometry = new BoxGeometry(t.size, t.size, depth);
    // Standard rather than Lambert, so the ground answers to the environment
    // map the same way every model on top of it does. Lambert has no roughness
    // and no ambient specular, so the one surface covering the whole board was
    // the one surface that stayed flat.
    //
    // The unlit colour, because this renderer lights the scene itself. Using
    // the pre-shaded one applied the light level twice over.
    const material = new MeshStandardMaterial({
      color: new Color(t.baseColour),
      // Stone and water, not polish. Water gets the only smooth surface on the
      // board, which is what makes it read as water from above rather than as
      // blue floor.
      roughness: t.kind === 'WATER' || t.kind === 'DEEP_WATER' || t.kind === 'ICE' ? 0.25 : 0.9,
      metalness: 0,
    });
    const mesh = new Mesh(geometry, material);
    // A wall grows up from its base and a plinth hangs down from the ledge, so
    // the clearance is taken off the top in both cases.
    mesh.position.set(t.x, t.y,
      wall ? t.base + depth / 2 : t.base - ART_CLEARANCE - depth / 2);
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

    // Unlit, like the turn ring above it and for the same reason. A token is a
    // marker rather than an object in the room: its colour *is* information —
    // healthy, bloodied, down, waiting — and a marker that dims because the
    // crypt is dark is a marker a DM cannot use. Everything else on the board
    // answers to the light; these deliberately do not.
    const body = new Mesh(
      new CircleGeometry(radius * 0.92, 32),
      new MeshBasicMaterial({
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
    this.clear(this.tokens);
    this.light.value?.dispose();
    this.environments.dispose();
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
  meshCounts(): { tiles: number; art: number; props: number; tokens: number } {
    return {
      tiles: this.terrain.children.length,
      art: this.terrainArt.children.length,
      props: this.props.children.length,
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
