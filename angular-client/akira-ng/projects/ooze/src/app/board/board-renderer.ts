import {
  AmbientLight, BoxGeometry, CircleGeometry, Color, DirectionalLight, Group, Mesh,
  AdditiveBlending, CanvasTexture, Color as ThreeColor, CylinderGeometry, DataTexture,
  LinearFilter, Material, MeshBasicMaterial, NeutralToneMapping, MeshStandardMaterial, Sprite,
  SpriteMaterial,
  Object3D, OrthographicCamera, PCFShadowMap, PerspectiveCamera, Plane, Raycaster, RGBAFormat,
  RingGeometry, Scene, ClampToEdgeWrapping, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { BoardScene, PropPlacement, TerrainTile, TokenPlacement } from './board.models';
import { BoardTheme, PLAIN_THEME, pieceFor } from './board-assets';
import { WALL_HEIGHT } from './board-scene';
import { ModelLibrary } from './model-library';
import { EnvironmentLibrary } from './environment';
import { FLAME_COLOUR, LIGHT_RANGE, lightField, lightSource } from './light-field';
import { PostChain } from './board-post';

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
   *
   * <p>Warm, and dimmer than it was. It is no longer carrying the whole scene —
   * the environment map does the ambient now — so its job is shape and shadow,
   * and a neutral white key over a warm cellar reads as two rooms disagreeing.
   */
  private readonly sun = new DirectionalLight(0xffe9cc, 0.95);

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

  /**
   * Everything burning, and how big it was drawn.
   *
   * <p>Held so the render loop can make them move. A flame that is perfectly
   * still is the one thing on a lit board that reads as a light *source* and
   * looks like a decal — and a torch is the first thing an eye goes to, so it
   * is the worst place on the board to be still.
   */
  private readonly flames: { sprite: Sprite; scale: number; seed: number }[] = [];

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
    this.flames.length = 0;
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
      const flame = this.flame(prop);
      if (flame) {
        this.props.add(flame.sprite);
        this.flames.push(flame);
      }
    }
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
  private flame(prop: PropPlacement): { sprite: Sprite; scale: number; seed: number } | null {
    const source = lightSource(prop.piece);
    if (!source) {
      return null;
    }
    const sprite = new Sprite(new SpriteMaterial({
      map: glow(),
      color: new ThreeColor(FLAME_COLOUR[0], FLAME_COLOUR[1], FLAME_COLOUR[2]),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      // Over one, so the bloom pass has something above its threshold to find.
      opacity: 1,
    }));
    // Sized and lifted off the piece it belongs to: a wall torch burns at head
    // height and a candle burns at table height, and the pack's own proportions
    // are the only thing that knows which.
    const scale = source.bright * 0.22;
    sprite.scale.set(scale, scale, 1);
    sprite.position.set(prop.x, prop.y, prop.z + source.bright * 0.14);
    // Seeded from where it stands, so two torches in a room never flicker in
    // step — which is the thing that gives a fake flame away instantly — and so
    // the same board always flickers the same way.
    return { sprite, scale, seed: (prop.x * 7 + prop.y * 13) % 100 };
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
      flame.sprite.scale.set(flame.scale * wobble, flame.scale * wobble, 1);
      const material = flame.sprite.material;
      material.opacity = 0.78 + 0.22 * wobble;
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
  private lit<T extends Material>(material: T, blend = 1, ripple = false): T {
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
         vBoardPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
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
    material.customProgramCacheKey = () => `board-light-${blend}-${ripple ? 'wet' : 'dry'}`;
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
    const wet = t.kind === 'WATER' || t.kind === 'DEEP_WATER';
    const material = new MeshStandardMaterial({
      color: new Color(t.baseColour),
      // Stone and water, not polish. Water gets the only smooth surface on the
      // board, which is what makes it read as water from above rather than as
      // blue floor.
      // Smooth, so the environment shows up in it as a highlight that moves
      // when the surface does.
      roughness: wet ? 0.12 : t.kind === 'ICE' ? 0.25 : 0.9,
      // Zero, even for water, and this was worth getting wrong once. Metalness
      // tints the reflection by the base colour and drops the diffuse, so a
      // blue surface at 0.35 reflected a warm cellar as bright cyan and stopped
      // looking like water at all. Water is a dielectric: a dark body with a
      // clean highlight on top, which is what these two numbers now are.
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
    const ratio = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    if (this.effects && !this.post) {
      this.post = new PostChain(this.renderer, this.scene, this.camera, this.width, this.height);
    }
    this.post?.setSize(this.width, this.height, ratio);
    this.applyFrame();
    this.place();
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
    if (!on) {
      this.post?.dispose();
      this.post = null;
      return;
    }
    if (!this.post && this.width > 1) {
      this.post = new PostChain(this.renderer, this.scene, this.camera, this.width, this.height);
      this.post.setSize(this.width, this.height, Math.min(globalThis.devicePixelRatio ?? 1, 2));
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
    this.clear(this.tokens);
    this.light.value?.dispose();
    this.post?.dispose();
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

/**
 * A soft round glow, drawn once and shared by every flame on the board.
 *
 * <p>Generated rather than shipped: it is a radial gradient, and a file for a
 * radial gradient is a file to lose.
 */
let glowTexture: CanvasTexture | null = null;

function glow(): CanvasTexture {
  if (glowTexture) {
    return glowTexture;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // A hot core that falls away fast, then a long tail. A linear falloff reads
    // as a disc with a soft edge; this reads as something burning.
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.18, 'rgba(255,226,170,0.85)');
    gradient.addColorStop(0.45, 'rgba(255,160,70,0.28)');
    gradient.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  glowTexture = new CanvasTexture(canvas);
  return glowTexture;
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
