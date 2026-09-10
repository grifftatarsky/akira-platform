import {
  AdditiveBlending, AmbientLight, BoxGeometry, BufferGeometry,
  ClampToEdgeWrapping, Color, CylinderGeometry, DataTexture, DirectionalLight,
  Float32BufferAttribute, Group, InstancedMesh, LineBasicMaterial, LineSegments, LinearFilter,
  Material, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, NeutralToneMapping, Object3D, OrthographicCamera,
  PCFShadowMap, PerspectiveCamera, Plane, PlaneGeometry, RGBAFormat, Raycaster, RingGeometry,
  Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { BoardScene, PropKind, PropPlacement, TerrainTile, TokenPlacement } from './board.models';
import { BoardLook, BoardPiece, BoardTheme, INDOOR_LOOK, PLAIN_THEME, pieceFor } from './board-assets';
import { WALL_HEIGHT } from './board-scene';
import { ModelLibrary } from './model-library';
import { EnvironmentLibrary } from './environment';
import { FLAME_COLOUR, LIGHT_RANGE, lightField, lightSource } from './light-field';
import { PostChain } from './board-post';
import { Motes } from './board-motes';
import { sunPosition, sunlight } from './sun-position';
import { SplatSurface, splatGround } from './ground-splat';
import { ScatterLayer, scatterGround } from './ground-scatter';
import { groundField } from './ground-field';

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
 * How much of the board's light a token's face takes, from none to all.
 *
 * <p>About half. Enough that a creature in the crypt is visibly in the crypt,
 * and never enough to make it hard to find — a marker that can become
 * unreadable is not a marker.
 */
const TOKEN_LIGHT_BLEND = 0.55;

/**
 * How far the grid floats over the ground it marks, in half-feet.
 *
 * <p>A quarter of a foot: clear of a plain floor tile, and deliberately *not*
 * clear of the rubble, so a grid line disappears into a pile of loose stone
 * rather than floating over it. Well under a token, which stands on top of it.
 */
const GRID_LIFT = 0.5;

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
   * The squares, drawn.
   *
   * <p>Lit, which took two tries to get right. An unlit line is a constant
   * colour against a floor whose brightness varies five-fold across the board,
   * so it cannot hold its contrast: a warm line was invisible in the torchlit
   * hall and glaring in the crypt, and a mid-grey one was merely faint in both.
   * Taking the same light as the floor makes the line a fixed *fraction*
   * brighter than whatever it is drawn on, which is what constant contrast
   * actually means.
   */
  private readonly grid = new Group();

  /**
   * Dust in the air, rebuilt with the board it hangs over.
   *
   * <p>Part of the effects layer rather than of the scene: it is atmosphere,
   * and a machine that cannot afford ambient occlusion should not be paying for
   * dust either.
   */
  private motes: Motes | null = null;

  /**
   * The outdoor ground, when the theme has one.
   *
   * <p>Mutually exclusive with the tiles: a splat ground *is* the ground, so
   * there are no boxes under it and no per-square pieces on it. A dungeon and a
   * meadow are built differently and pretending otherwise would mean one code
   * path that is wrong for both.
   */
  private surface: SplatSurface | null = null;

  /** The board last drawn, so the sun can be re-aimed when the clock moves. */
  private framed: BoardScene | null = null;

  /** Whatever is lying on that ground: tufts, stones, fallen branches. */
  private litter: ScatterLayer | null = null;

  /**
   * The height the picture is actually rendered at, in device pixels.
   *
   * <p>Fixed, and the width follows from the viewport's shape so nothing is
   * stretched. Everything expensive on this board — occlusion, bloom, the
   * splat ground's twelve texture reads — costs per pixel, and a 5K display
   * asks for eleven times the pixels of this while showing the same board.
   */
  private renderHeight = 720;
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
   *
   * <p>Warm, and dimmer than it was. It is no longer carrying the whole scene —
   * the environment map does the ambient now — so its job is shape and shadow,
   * and a neutral white key over a warm cellar reads as two rooms disagreeing.
   */
  private readonly sun = new DirectionalLight(0xffe9cc, 0.95);
  private readonly ambient = new AmbientLight(0xffffff, INDOOR_LOOK.ambient);
  private sunElevation = 68;
  private sunAzimuth = 145;
  private look: BoardLook = INDOOR_LOOK;
  private hour = INDOOR_LOOK.hour;

  /**
   * The board's light, shared by every material that answers to it.
   *
   * <p>One object handed to every patched shader, so replacing the texture on a
   * new board updates all of them at once rather than four hundred times.
   */
  private readonly light: { value: DataTexture | null } = { value: null };
  private readonly extent = { value: new Vector2(1, 1) };

  /** Seconds since the board opened, for anything that moves in a shader. */
  private readonly time = { value: 0 };

  /**
   * Materials already patched.
   *
   * <p>Weak, and needed: a cloned model shares its source's material, so a room
   * with thirty barrels hands the same material back thirty times, and patching
   * a shader twice injects the sample twice — which squares the light and turns
   * a torch into a floodlight.
   */
  private readonly patched = new WeakSet<Material>();

  /** Where each tile's box ended up, so its art can switch it off later. */
  private tileSlots: ({ mesh: InstancedMesh; slot: number } | undefined)[] = [];

  /**
   * Everything burning, and how big it was drawn.
   *
   * <p>Held so the render loop can make them move. A flame that is perfectly
   * still is the one thing on a lit board that reads as a light *source* and
   * looks like a decal — and a torch is the first thing an eye goes to, so it
   * is the worst place on the board to be still.
   */
  private readonly flames: Flame[] = [];

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  private library: ModelLibrary;
  private readonly environments: EnvironmentLibrary;
  /**
   * Ambient occlusion and bloom, if this machine is having them.
   *
   * <p>Built on the first resize rather than in the constructor, because both
   * passes allocate render targets the size of the viewport and the viewport is
   * one pixel by one until the ResizeObserver has spoken.
   */
  private post: PostChain | null = null;
  private effects = true;
  private showGrid = true;
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
    this.applyLook(theme);
    void this.lightScene(theme);

    this.scene.add(this.terrain);
    this.scene.add(this.terrainArt);
    this.scene.add(this.props);
    this.scene.add(this.grid);
    this.scene.add(this.tokens);

    // A trace of flat fill, and no more. The ambient term used to be 0.75 and
    // was doing the job an environment map does properly — flatly, from every
    // direction at once, which is why nothing on the board had a lit side and a
    // shaded side. Now the environment carries the ambient and this only keeps
    // the deepest corners off pure black.
    this.scene.add(this.ambient);
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
    this.clear(this.grid);
    this.clear(this.tokens);
    this.flames.length = 0;
    this.relight(board);
    this.surface?.dispose();
    this.surface = null;
    this.litter?.dispose();
    this.litter = null;
    if (this.theme.ground) {
      const ground = this.theme.ground;
      this.surface = splatGround(ground, board, this.light, this.extent);
      this.terrain.add(this.surface.mesh);
      // The scatter shares the ground's own wear field rather than building a
      // second one, so a stone can never land somewhere the road is not.
      const field = groundField(board);
      const generation = this.generation + 1;
      void scatterGround(ground, board, field, m => this.lit(m)).then(layer => {
        if (this.disposed || generation !== this.generation) {
          layer.dispose();
          return;
        }
        this.litter = layer;
        layer.meshes.forEach(mesh => this.terrainArt.add(mesh));
      });
    } else {
      this.layGround(board);
    }
    this.raiseDust(board);
    this.grid.add(this.squares(board));
    this.grid.visible = this.showGrid;
    board.tokens.forEach(t => this.tokens.add(this.token(t)));
    this.framed = board;
    this.aimSun(board);
    this.place();
    const generation = ++this.generation;
    // A splat ground carries its own materials, so there is nothing to dress it
    // with; the props on top of it are still pieces like any others.
    if (!this.theme.ground) {
      void this.dressTerrain(board, generation);
    }
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
    // Placed from a real elevation and bearing rather than from a nudge that
    // looked right once. High light keeps a wall's shadow under half its
    // height, which reads as depth without reading as ground a DM has to
    // discount; and outdoors the angle is simply what time it is.
    const elevation = (this.sunElevation * Math.PI) / 180;
    const azimuth = (this.sunAzimuth * Math.PI) / 180;
    const reach = span * 1.4;
    this.sun.position.set(
      cx + reach * Math.cos(elevation) * Math.sin(azimuth),
      cy + reach * Math.cos(elevation) * Math.cos(azimuth),
      cy * 0 + reach * Math.sin(elevation),
    );
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

  /** Points the sun, and re-aims it over whatever board is loaded. */
  private pointSun(elevation: number, azimuth: number): void {
    this.sunElevation = elevation;
    this.sunAzimuth = azimuth;
    if (this.framed) {
      this.aimSun(this.framed);
    }
  }

  /** Swaps the art without touching anything else about the board. */
  setTheme(theme: BoardTheme): void {
    if (theme.id === this.theme.id) {
      return;
    }
    this.theme = theme;
    // The old library owns shared buffers on the device that nothing else is in
    // a position to free — a theme swap makes a whole one garbage at once.
    this.library.dispose();
    this.library = new ModelLibrary(theme);
    this.applyLook(theme);
    void this.lightScene(theme);
  }

  /**
   * Sets the scene to the theme's own light and grade.
   *
   * <p>Everything here was a constant tuned against a torchlit cellar, which is
   * a perfectly good look for a cellar and turns a July afternoon into dusk. A
   * theme brings its assets *and* the light they were meant to be seen in.
   */
  private applyLook(theme: BoardTheme): void {
    const look = theme.look ?? INDOOR_LOOK;
    this.look = look;
    this.hour = look.hour;
    this.renderer.toneMappingExposure = look.exposure;
    this.ambient.intensity = look.ambient;
    this.post?.setGrade(look.saturation, look.contrast, look.vignette);
    this.applyClock();
  }

  /**
   * Moves the clock.
   *
   * <p>Everything about the sun follows: how high it is, which way it throws a
   * shadow, how strong it is and what colour. Which is the point of making it
   * a clock rather than four sliders — a low sun that is still white and full
   * strength is not a time of day, it is a mistake.
   */
  setHour(hour: number): void {
    this.hour = Math.max(0, Math.min(24, hour));
    this.applyClock();
    this.place();
  }

  hourOfDay(): number {
    return this.hour;
  }

  /** Whether this board has a sky to have a time of day in. */
  hasClock(): boolean {
    return !this.look.fixedSun;
  }

  private applyClock(): void {
    if (this.look.fixedSun) {
      this.sun.intensity = this.look.fixedSun.intensity;
      this.sun.color.set(this.look.fixedSun.colour);
      this.pointSun(this.look.fixedSun.elevation, this.look.fixedSun.azimuth);
      return;
    }
    const at = sunPosition(this.hour, this.look.latitude, this.look.dayOfYear);
    const light = sunlight(at.elevation);
    this.sun.intensity = light.intensity;
    this.sun.color.set(light.colour);
    // Below the horizon the sun contributes nothing, but its shadow camera
    // still has to point somewhere sane, so it is parked just above it.
    this.pointSun(Math.max(1, at.elevation), at.azimuth);
    // The sky map is a noon capture and cannot change with the clock, so the
    // ambient it provides is dimmed to follow the sun instead. An evening lit
    // by a midday sky is the one thing that would give this away.
    const dusk = Math.max(0.12, Math.min(1, Math.sin(Math.max(0, at.elevation) * Math.PI / 180)
      * 1.25));
    this.scene.environmentIntensity = (this.theme.environment?.intensity ?? 1) * dusk;
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
    this.applyClock();
    // Outdoors the sky is most of what says where you are; indoors a horizon
    // behind the walls would put the dungeon on a hilltop.
    this.scene.background = theme.sky ? map : null;
  }

  /**
   * Replaces each tile's box with the theme's model, where it has one.
   *
   * <p>The box stays when the model is missing, which is the whole of making a
   * pack removable: delete the files and the board reverts to what it always
   * drew, with nothing to switch off.
   */
  private async dressTerrain(board: BoardScene, generation: number): Promise<void> {
    const byPiece = new Map<BoardPiece, number[]>();
    board.tiles.forEach((tile, index) => {
      const piece = pieceFor(tile.kind);
      if (!piece) {
        return;
      }
      const bucket = byPiece.get(piece);
      if (bucket) {
        bucket.push(index);
      } else {
        byPiece.set(piece, [index]);
      }
    });

    const matrix = new Matrix4();
    for (const [piece, indices] of byPiece) {
      const first = board.tiles[indices[0]];
      // Every tile of a kind is the same size, and a wall is the same height as
      // every other wall — so one shape serves the whole bucket.
      const model = await this.library.instanced(
        piece, first.size, first.height > 0 ? first.height : undefined);
      // The board may have been replaced or disposed while a model loaded; a
      // late arrival must not decorate a scene nobody is looking at.
      if (this.disposed || generation !== this.generation) {
        return;
      }
      if (!model) {
        continue;
      }
      const mesh = new InstancedMesh(model.geometry, this.litAll(model.material), indices.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      indices.forEach((tileIndex, slot) => {
        const tile = board.tiles[tileIndex];
        matrix.makeRotationZ(tile.rotation);
        matrix.setPosition(tile.x, tile.y, tile.base);
        mesh.setMatrixAt(slot, matrix);
        // The box goes quiet only under a floor tile at ground level, where the
        // model covers the square exactly and the box is nothing but colour
        // underneath. It stays under a raised floor, where it is the plinth —
        // and it stays behind a wall, where it is the wall's mass: KayKit's
        // wall is a 1 1/4-foot facing panel, so hiding the box left every
        // corner and junction with a hole through it and rooms you could walk
        // out of.
        if (tile.base <= 0 && tile.height === 0) {
          this.hideBox(tileIndex);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.terrainArt.add(mesh);
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
    const byPiece = new Map<PropKind, PropPlacement[]>();
    for (const prop of board.props) {
      const bucket = byPiece.get(prop.piece);
      if (bucket) {
        bucket.push(prop);
      } else {
        byPiece.set(prop.piece, [prop]);
      }
      const flame = this.flame(prop);
      if (flame) {
        this.props.add(flame.quad);
        this.flames.push(flame);
      }
    }

    const matrix = new Matrix4();
    for (const [piece, placements] of byPiece) {
      const model = await this.library.instanced(piece, square);
      if (this.disposed || generation !== this.generation) {
        return;
      }
      if (!model) {
        continue;
      }
      const mesh = new InstancedMesh(model.geometry, this.litAll(model.material), placements.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      placements.forEach((prop, slot) => {
        matrix.makeRotationZ(prop.rotation);
        matrix.setPosition(prop.x, prop.y, prop.z);
        mesh.setMatrixAt(slot, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.props.add(mesh);
    }
  }

  /**
   * The five-foot squares, as one set of lines.
   *
   * <p>Every square is a cost: five feet of movement, and the unit reach and
   * cover are counted in. A board that does not show them makes a DM estimate
   * something the engine is being exact about, which is the one job a tactical
   * board has.
   *
   * <p>Drawn per tile at that tile's own height, so a raised terrace carries
   * its own grid rather than one floating across it — and only two edges per
   * square, so every interior line is drawn exactly once. Four would double
   * every shared edge, and a translucent line drawn twice is twice as bright as
   * one drawn once: the grid would come out with a brighter mesh inside a
   * fainter border.
   */
  private squares(board: BoardScene): LineSegments {
    const points: number[] = [];
    for (const tile of board.tiles) {
      // Not over walls. Nothing stands on one, and a grid across the tops of
      // the room walls reads as a floor you could walk on.
      if (tile.height > 0) {
        continue;
      }
      const half = tile.size / 2;
      const z = tile.base + GRID_LIFT;
      points.push(tile.x - half, tile.y - half, z, tile.x + half, tile.y - half, z);
      points.push(tile.x - half, tile.y - half, z, tile.x - half, tile.y + half, z);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    return new LineSegments(geometry, this.lit(new LineBasicMaterial({
      // Roughly twice the stone it is drawn on, so once both are multiplied by
      // the same light the line is consistently the brighter of the two.
      color: 0xcec2a6,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })));
  }

  /**
   * Rings the token under the pointer.
   *
   * <p>Feedback before commitment: without it a board gives no sign that a
   * press would pick anything up, so a drag that starts a few pixels off a
   * token pans the whole board instead — and the two gestures are told apart by
   * exactly this, whether something was under the pointer when it went down.
   */
  setHovered(id: string | null): void {
    for (const token of this.tokens.children) {
      const wanted = token.userData?.['id'] === id;
      for (const child of token.children) {
        if (child.userData?.['hoverRing']) {
          child.visible = wanted;
        }
      }
    }
  }

  /**
   * Fills the air over a board with dust.
   *
   * <p>Rebuilt per board rather than moved, because the count comes from the
   * board's area — a corridor and a courtyard want different amounts of nothing
   * in the air.
   */
  private raiseDust(board: BoardScene): void {
    if (this.motes) {
      this.scene.remove(this.motes.points);
      this.motes.dispose();
    }
    this.motes = new Motes(board.widthHalfFeet, board.heightHalfFeet, this.look.motes);
    this.lit(this.motes.material(), 1, false, true);
    this.motes.points.visible = this.effects;
    this.scene.add(this.motes.points);
  }

  /** Shows or hides the squares. */
  setGrid(on: boolean): void {
    this.showGrid = on;
    this.grid.visible = on;
  }

  gridOn(): boolean {
    return this.showGrid;
  }

  /**
   * The visible glow on something that is burning.
   *
   * <p>The light field already lights the room a torch is in; this is the
   * flame itself, which is a different thing and the one you look at. An
   * additive sprite rather than an emissive material, because the flame is a
   * few pixels of a shared texture atlas and there is no way to make part of an
   * atlas glow — and because a sprite always faces the camera, which is exactly
   * right for something that has no shape of its own.
   *
   * <p>Brighter than full white on purpose. That is what the bloom pass looks
   * for, and it is the whole reason the chain carries half-float buffers.
   */
  private flame(prop: PropPlacement): Flame | null {
    const source = lightSource(prop.piece);
    if (!source) {
      return null;
    }
    const scale = source.bright * 0.22;
    const material = new ShaderMaterial({
      uniforms: {
        uSize: { value: scale },
        uColour: { value: new Color(FLAME_COLOUR[0], FLAME_COLOUR[1], FLAME_COLOUR[2]) },
        uIntensity: { value: 1 },
      },
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(1, 1), material);
    // The geometry is a unit quad and the size is applied in the shader, so
    // three's bounding sphere is far smaller than what gets drawn and it would
    // cull a flame that is only half off the edge of the screen.
    quad.frustumCulled = false;
    quad.position.set(prop.x, prop.y, prop.z + source.bright * 0.14);
    // Seeded from where it stands, so two torches in a room never flicker in
    // step — which is the thing that gives a fake flame away instantly — and so
    // the same board always flickers the same way.
    return { quad, material, scale, seed: (prop.x * 7 + prop.y * 13) % 100 };
  }

  /**
   * Makes the flames move.
   *
   * <p>Two sine waves at unrelated speeds rather than a random number per
   * frame: noise reads as television static, and a flame is not random — it
   * surges and settles. The pair beat against each other and never repeat
   * inside a session, which is all "never repeats" has to mean here.
   *
   * <p>The pool of light on the floor deliberately does not flicker with it.
   * That would mean rebuilding and re-uploading the light field every frame for
   * an effect nobody would consciously notice, and the sprite is the part an
   * eye is actually watching.
   */
  private flicker(seconds: number): void {
    for (const flame of this.flames) {
      const wobble = 1
        + 0.10 * Math.sin(seconds * 6.1 + flame.seed)
        + 0.05 * Math.sin(seconds * 13.7 + flame.seed * 2.3);
      flame.material.uniforms['uSize'].value = flame.scale * wobble;
      flame.material.uniforms['uIntensity'].value = 0.8 + 0.3 * wobble;
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
  private lit<T extends Material>(material: T, blend = 1, ripple = false, round = false): T {
    if (this.patched.has(material)) {
      return material;
    }
    this.patched.add(material);
    material.onBeforeCompile = shader => {
      shader.uniforms['uBoardLight'] = this.light;
      shader.uniforms['uBoardExtent'] = this.extent;
      shader.uniforms['uBoardTime'] = this.time;
      shader.vertexShader = 'varying vec3 vBoardPos;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           // Three applies the instance matrix in <project_vertex>, which runs
           // after this. Without it every barrel in a room would sample the
           // light at the position of the first one — one lit crate and
           // twenty-nine in the dark, or worse, all thirty lit by a torch that
           // is only over one of them.
           vBoardPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
         #else
           vBoardPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         #endif`);
      shader.fragmentShader =
        'varying vec3 vBoardPos;\nuniform sampler2D uBoardLight;\nuniform vec2 uBoardExtent;\n'
        + 'uniform float uBoardTime;\n'
        + (ripple ? RIPPLE : '') + '\n'
        + shader.fragmentShader.replace(
          '#include <tonemapping_fragment>',
          `gl_FragColor.rgb *= mix(
             vec3(1.0),
             texture2D(uBoardLight, vBoardPos.xy / uBoardExtent).rgb * ${LIGHT_RANGE.toFixed(1)},
             ${blend.toFixed(2)});
           #include <tonemapping_fragment>`);
      if (round) {
        // Points are squares unless something says otherwise, and the
        // something is normally a texture. This is the same lesson the flames
        // taught: a shape computed in the shader cannot arrive as a square.
        // `gl_PointCoord` runs 0..1 across the point, so the distance from its
        // middle is the whole of it.
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <tonemapping_fragment>',
          `float boardDot = length(gl_PointCoord - 0.5) * 2.0;
           if (boardDot > 1.0) { discard; }
           gl_FragColor.a *= 1.0 - smoothstep(0.25, 1.0, boardDot);
           #include <tonemapping_fragment>`);
      }
      if (ripple) {
        // After three has finished deciding what the surface normal is —
        // including any normal map — and before it lights anything with it.
        // Perturbing the normal rather than the geometry is the whole trick: it
        // costs four sines, it is what the reflection actually reads, and a
        // flat quad ripples without a single extra vertex.
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\n normal = rippled(normal, vBoardPos, uBoardTime);');
      }
    };
    // Without this three reuses a cached program compiled from an identical
    // material that was never patched, and the injection silently does nothing
    // for every material after the first. The blend is in the key because it is
    // compiled into the shader, so two blends are two programs.
    material.customProgramCacheKey = () =>
      `board-light-${blend}-${ripple ? 'wet' : 'dry'}-${round ? 'round' : 'square'}`;
    return material;
  }

  /**
   * The same, for a piece that turned out to have more than one material.
   *
   * <p>Rare — every piece in the pack is one mesh off one atlas — but a pack
   * that is not must not silently lose its lighting.
   */
  private litAll<T extends Material | Material[]>(material: T): T {
    if (Array.isArray(material)) {
      material.forEach(m => this.lit(m));
      return material;
    }
    this.lit(material);
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
   * The ground, as instanced boxes.
   *
   * <p>Zero-height boxes rather than planes, so a floor and a wall are the same
   * kind of object and raising one is a number rather than a different mesh.
   *
   * <p>Grouped by material and not by terrain, because that is what actually
   * has to differ: colour rides on the instance, and only roughness, metalness
   * and whether the surface ripples need their own draw. A 520-square level is
   * three calls.
   */
  private layGround(board: BoardScene): void {
    const buckets = new Map<GroundSurface, number[]>();
    board.tiles.forEach((tile, index) => {
      const surface = surfaceOf(tile);
      const bucket = buckets.get(surface);
      if (bucket) {
        bucket.push(index);
      } else {
        buckets.set(surface, [index]);
      }
    });

    this.tileSlots = new Array(board.tiles.length);
    const matrix = new Matrix4();
    const colour = new Color();

    for (const [surface, indices] of buckets) {
      const size = board.tiles[indices[0]].size;
      const mesh = new InstancedMesh(
        new BoxGeometry(size, size, 1), this.lit(groundMaterial(surface), 1, surface === 'WET'),
        indices.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      indices.forEach((tileIndex, slot) => {
        const tile = board.tiles[tileIndex];
        mesh.setMatrixAt(slot, boxMatrix(tile, matrix));
        mesh.setColorAt(slot, colour.set(tile.baseColour));
        this.tileSlots[tileIndex] = { mesh, slot };
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
      this.terrain.add(mesh);
    }
  }

  /**
   * Takes a square's box out of the scene without disturbing anything else.
   *
   * <p>An instance cannot be removed, so it is scaled to nothing. Which is
   * exactly as good — it contributes no pixels — and leaves every other slot in
   * the buffer where it was.
   */
  private hideBox(tileIndex: number): void {
    const slot = this.tileSlots[tileIndex];
    if (!slot) {
      return;
    }
    slot.mesh.setMatrixAt(slot.slot, NOWHERE);
    slot.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * A creature, as a miniature's base.
   *
   * <p>Round, and as wide as the creature's space — so a Gargantuan one covers
   * the twenty feet it actually occupies rather than an icon's worth.
   *
   * <p><b>The side takes the light and the face takes about half of it.</b>
   * Both extremes are wrong and it took building them to see it. Fully lit, a
   * token vanishes the moment a creature walks into the dark — which is exactly
   * when a DM needs to find it. Fully unlit, it escapes the atmosphere
   * entirely: once the room around it had an environment map, a tone curve and
   * a colour grade, a flat disc of constant colour read as a plastic counter
   * dropped onto a painting, and got worse every time the lighting got better.
   *
   * <p>Half-lit is neither. The face still darkens as a creature walks into the
   * crypt, so it belongs to the room, and it never darkens past legible, so it
   * is still a marker. The base's side is fully lit and casts a shadow like
   * anything else standing on the floor.
   */
  private token(t: TokenPlacement): Group {
    const group = new Group();
    const radius = t.size / 2;
    // Proportional but capped: a base scaled straight off a Gargantuan
    // creature's twenty-foot space would be a two-foot plinth.
    const height = Math.min(2.2, Math.max(0.9, t.size * 0.11))
      // A creature on the floor is flat on the floor. Prone is a condition a DM
      // has to see from across the table, and a low base says it without a
      // legend.
      * (t.down ? 0.35 : 1);

    const geometry = new CylinderGeometry(radius * 0.92, radius * 0.92, height, 40);
    // Three's cylinder stands up its own Y; this world's up is Z.
    geometry.rotateX(Math.PI / 2);

    const face = this.lit(new MeshBasicMaterial({
      color: new Color(t.colour),
      transparent: t.onDeck,
      opacity: t.onDeck ? 0.5 : 1,
    }), TOKEN_LIGHT_BLEND);
    const side = this.lit(new MeshStandardMaterial({
      // Pewter, so it belongs to the room rather than to the token's state —
      // the colour above is the information and this must not compete with it.
      color: 0x26262c,
      roughness: 0.5,
      metalness: 0.15,
      transparent: t.onDeck,
      opacity: t.onDeck ? 0.5 : 1,
    }));
    // Cylinder groups are side, top, bottom in that order.
    const body = new Mesh(geometry, [side, face, face]);
    body.position.z = height / 2;
    body.castShadow = !t.down;
    body.receiveShadow = true;
    group.add(body);

    if (t.acting) {
      // The turn marker, unlit for the same reason the face is.
      const ring = new Mesh(
        new RingGeometry(radius * 0.97, radius * 1.14, 40),
        new MeshBasicMaterial({ color: 0xf0c674 }),
      );
      ring.position.z = height + 0.05;
      group.add(ring);
    }

    // Built now and hidden, rather than made on hover. A pointer moving across
    // a board would otherwise allocate a geometry, a material and a shader
    // compile per token it crossed — for a highlight that lasts as long as the
    // pointer keeps moving.
    const hover = new Mesh(
      new RingGeometry(radius * 1.16, radius * 1.3, 40),
      new MeshBasicMaterial({ color: 0xdce6f0, transparent: true, opacity: 0.75 }),
    );
    hover.position.z = height + 0.05;
    hover.visible = false;
    hover.userData = { hoverRing: true };
    group.add(hover);

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
    this.post?.setCamera(this.camera);
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
    // A long lens, not a wide one. Fifty degrees puts the near corner of a
    // room a great deal closer than the far one and the board reads as a
    // fishbowl; thirty-four flattens the perspective toward the isometric look
    // this is aimed at, while keeping enough of it that a wall still has a
    // visible face.
    const camera = new PerspectiveCamera(34, 1, 1, 6000);
    // Z is up, because the engine's elevation is Z and re-basing the world to
    // three's Y-up default would put a conversion between the data and the
    // picture — the one place it must not be.
    camera.up.set(0, 0, 1);
    return camera;
  }

  /** Points the camera at the board, whichever camera it is. */
  private place(): void {
    // The element's shape, which the buffer matches — so this is the buffer's
    // aspect too, and neither camera has to know the picture is being scaled.
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

  /**
   * Fits the picture to the element, at a fixed rendering height.
   *
   * <p><b>The canvas and the buffer are two different sizes and that is the
   * point.</b> The element is whatever the layout gives it and CSS stretches
   * the result to fill it; the buffer is {@link renderHeight} tall, with its
   * width taken from the element's shape so the image is never distorted.
   *
   * <p>Locked because everything expensive here costs per pixel — ambient
   * occlusion, bloom, and a splat ground that reads twelve textures for every
   * fragment — and a 5K display would otherwise ask for eleven times the work
   * to show the same board at the same apparent size.
   */
  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const shape = this.width / this.height;
    const bufferHeight = Math.max(1, Math.round(this.renderHeight));
    const bufferWidth = Math.max(1, Math.round(bufferHeight * shape));
    // One device pixel per buffer pixel: the ratio is already expressed by
    // rendering smaller than the element and letting CSS scale it up.
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(bufferWidth, bufferHeight, false);
    if (this.effects && !this.post) {
      this.post = new PostChain(this.renderer, this.scene, this.camera, bufferWidth, bufferHeight);
      this.post.setGrade(this.look.saturation, this.look.contrast, this.look.vignette);
    }
    this.post?.setSize(bufferWidth, bufferHeight, 1);
    this.applyFrame();
    this.place();
  }

  /** The height the picture is rendered at, whatever size the element is. */
  setRenderHeight(pixels: number): void {
    this.renderHeight = Math.max(120, Math.min(2160, Math.round(pixels)));
    this.resize(this.width, this.height);
  }

  /**
   * Turns the expensive passes off, and on.
   *
   * <p>A real setting rather than a debug flag: ambient occlusion and bloom are
   * several full-screen passes, and a board that will not hold a frame rate is
   * worse than a board that is merely lit. Off, everything else still applies —
   * the environment, the tone curve and the light field are all in the scene
   * itself and cost nothing extra.
   */
  setEffects(on: boolean): void {
    this.effects = on;
    if (this.motes) {
      this.motes.points.visible = on;
    }
    if (!on) {
      this.post?.dispose();
      this.post = null;
      return;
    }
    if (!this.post && this.width > 1) {
      this.resize(this.width, this.height);
    }
  }

  effectsOn(): boolean {
    return this.effects;
  }

  start(): void {
    const loop = () => {
      if (this.disposed) {
        return;
      }
      this.time.value = performance.now() / 1000;
      this.flicker(this.time.value);
      if (this.effects) {
        this.motes?.step(this.time.value);
      }
      // Through the effect chain when there is one, straight to the canvas
      // when there is not. Both are real paths: the chain is several
      // full-screen passes and a machine that cannot afford them should still
      // get a lit board.
      if (this.post) {
        this.post.draw();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
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
    this.clear(this.grid);
    this.clear(this.tokens);
    this.surface?.dispose();
    this.litter?.dispose();
    this.light.value?.dispose();
    this.motes?.dispose();
    this.post?.dispose();
    this.library.dispose();
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
        // Anything the model library handed out is shared by every board that
        // will ever draw this piece, and is its to free. Disposing it here
        // would leave the next render pointing at a released buffer.
        if (child.geometry.userData['shared']) {
          return;
        }
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

/** Which of the three ground materials a square wants. */
type GroundSurface = 'DRY' | 'WET' | 'ICE';

function surfaceOf(tile: TerrainTile): GroundSurface {
  if (tile.kind === 'WATER' || tile.kind === 'DEEP_WATER') {
    return 'WET';
  }
  return tile.kind === 'ICE' ? 'ICE' : 'DRY';
}

function groundMaterial(surface: GroundSurface): MeshStandardMaterial {
  return new MeshStandardMaterial({
    // White, because the colour rides on the instance: three multiplies the
    // per-instance colour into this one, so anything but white would tint the
    // whole board.
    color: 0xffffff,
    // Smooth for water, so the environment shows up in it as a highlight that
    // moves when the surface does. Metalness stays at zero even there: it tints
    // the reflection by the base colour and drops the diffuse, so a blue
    // surface reflected a warm cellar as bright cyan and stopped looking like
    // water at all. Water is a dielectric — a dark body with a clean highlight.
    roughness: surface === 'WET' ? 0.12 : surface === 'ICE' ? 0.25 : 0.9,
    metalness: 0,
  });
}

/**
 * A square's box, as a matrix.
 *
 * <p>A wall grows up from its base and a floor's plinth hangs down from the
 * ledge, so the clearance comes off the top in both cases. The unit box is one
 * high, so the depth is a scale.
 */
function boxMatrix(tile: TerrainTile, into: Matrix4): Matrix4 {
  const wall = tile.height > 0;
  const depth = Math.max(0.2, (wall ? tile.height : Math.max(0.5, tile.base)) - ART_CLEARANCE);
  const z = wall ? tile.base + depth / 2 : tile.base - ART_CLEARANCE - depth / 2;
  return into.makeScale(1, 1, depth).setPosition(tile.x, tile.y, z);
}

/** An instance scaled to nothing, which is how one is taken out of a buffer. */
const NOWHERE = new Matrix4().makeScale(0, 0, 0);

/**
 * Two crossed wave trains, as a normal perturbation.
 *
 * <p>Enough to make water look like water from above and nothing like a
 * simulation. Four sines at unrelated frequencies never visibly repeat, which
 * is the only property a surface seen for ten seconds at a time needs — and it
 * costs no vertices, no texture and no second pass.
 */
const RIPPLE = `
  vec3 rippled(vec3 n, vec3 world, float t) {
    vec2 p = world.xy * 0.22;
    float x = 0.16 * sin(p.x + t * 0.9) + 0.10 * sin(p.y * 1.7 - t * 1.35);
    float y = 0.16 * sin(p.y * 1.1 + t * 1.1) + 0.10 * sin(p.x * 1.4 + t * 0.75);
    return normalize(n + vec3(x, y, 0.0));
  }
`;

/** One flame: the quad, its material, and how it was told to move. */
interface Flame {
  readonly quad: Mesh;
  readonly material: ShaderMaterial;
  readonly scale: number;
  readonly seed: number;
}

/**
 * A quad that always faces the camera, sized in the shader.
 *
 * <p>Billboarded here rather than by using three's `Sprite`, because a Sprite
 * needs a `SpriteMaterial` and a `SpriteMaterial` needs a *texture* to have a
 * shape. That texture was the bug: the glow was drawn on a canvas, and whatever
 * went wrong between the canvas and the GPU, what got drawn was the material's
 * flat colour across the whole quad — a hard-edged additive square at every
 * torch on the board, pulsing, because the flicker was animating its size.
 *
 * <p>Computing the falloff in the fragment shader instead removes the entire
 * class of problem. There is no image to upload, no colour space to get wrong
 * and no canvas to come back blank; a round flame is four lines of arithmetic
 * that cannot arrive as a square.
 */
const FLAME_VERTEX = `
  uniform float uSize;
  varying vec2 vQuad;
  void main() {
    vQuad = position.xy;
    // The object's own origin, in view space, with the quad's corners pushed
    // out on the screen plane — which is what "faces the camera" means.
    vec4 middle = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    middle.xy += position.xy * uSize;
    gl_Position = projectionMatrix * middle;
  }
`;

const FLAME_FRAGMENT = `
  uniform vec3 uColour;
  uniform float uIntensity;
  varying vec2 vQuad;
  void main() {
    // 0 at the middle, 1 at the edge of the quad.
    float d = length(vQuad) * 2.0;
    // A hot core and a long tail, added: the core is what reads as a flame and
    // the tail is what makes it sit in the air rather than on a card.
    float core = 1.0 - smoothstep(0.0, 0.30, d);
    float tail = 1.0 - smoothstep(0.0, 1.0, d);
    float alpha = core * 0.85 + tail * tail * 0.55;
    if (alpha <= 0.002) {
      discard;
    }
    // Not premultiplied: additive blending is SRC_ALPHA, ONE, so the alpha
    // does the falloff and the colour stays at full strength.
    gl_FragColor = vec4(uColour * uIntensity, alpha);
  }
`;

/**
 * The ground.
 *
 * <p>Constructed once: a Plane is immutable here and allocating one per pointer
 * move would churn the heap on the hottest path the board has.
 */
const GROUND = new Plane(new Vector3(0, 0, 1), 0);

/** Wall height, re-exported so a caller can size a legend without importing the scene. */
export { WALL_HEIGHT };
