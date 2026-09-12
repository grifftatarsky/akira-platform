import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { HDRCubeTexture } from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { TAARenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/taaRenderingPipeline';
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe';
import { Scene } from '@babylonjs/core/scene';
// <b>Side effects, both of them.</b> `forceSphericalPolynomialsRecompute` is
// patched onto `BaseTexture` by a separate module, and a probe that renders a
// new sky without it hands the PBR materials the *first* sky's irradiance
// forever — the specular moves with the sun and the diffuse does not.
import '@babylonjs/core/Materials/Textures/baseTexture.polynomial';
// <b>Screen-space ambient occlusion was tried here and taken out again.</b>
// `SSAO2RenderingPipeline` wants depth and normals in a multiple render target,
// which with deep imports is not on the engine at all — "createMultipleRenderTarget
// is not a function", thrown from inside the render loop on the first frame.
// Importing the extension got past that and into a stream of WebGPU validation
// errors with the meadow no longer drawing, which is a geometry prepass over a
// quarter of a million instanced plants meeting a path that was never asked to
// carry them.
//
// <p>It was the wrong instrument anyway. A prepass is a second geometry pass,
// and geometry is measurably the only thing this board is short of. The
// occlusion that matters in a sward is a plant's own neighbours shading its
// roots, and the compute pass already knows how thick each clump is — so that
// is where it is computed, for nothing.
import { SkyMaterial } from '@babylonjs/materials/sky/skyMaterial';
import type { BoardLook } from '../board-assets';
import { eyeExposure, sunPosition, sunlight } from '../sun-position';
import { assetUrl } from './assets';

const RAD = Math.PI / 180;

/**
 * The shape of `camera.movement.input` this file uses.
 *
 * <p>Typed here rather than imported because the deep-import path for it moves
 * between releases and the whole of what is wanted is one method.
 */
interface PanMap {
  setInteraction(
    source: string,
    conditions: { button?: number; modifiers?: Record<string, boolean> },
    interaction: string,
  ): boolean;
}

/**
 * Engine, scene, camera, sun, sky.
 *
 * <p><b>WebGPU only, no fallback.</b> Every browser ships it, compute is the
 * whole point of the scatter that comes next, and one backend means one shader
 * language. A WebGL2 path would double the shader work to serve nobody.
 *
 * <p>What is *not* in this file is most of what the old renderer did. The
 * shadow frustum is not fitted to the view here because
 * `CascadedShadowGenerator` does it; the sky is not a gradient because
 * `SkyMaterial` is a real atmosphere; the exposure is not a hand-rolled grade
 * because `ImageProcessingConfiguration` is one. What survives from before is
 * the arithmetic that says where the sun *is*, which no engine has an opinion
 * about.
 */
export class Stage {

  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly sun: DirectionalLight;
  readonly shadows: CascadedShadowGenerator;
  readonly ambient: HemisphericLight;
  /**
   * The light that comes back off the ground.
   *
   * <p>The third of Íñigo Quilez's three outdoor lights, and the one this scene
   * did not have. Its direction is the sun's, horizontally reversed and laid
   * flat on the horizon, because the main source of indirect light outdoors is
   * sunlight bouncing off the ground back the way it came. Its colour is warm
   * and its intensity is small.
   *
   * <p>It is aimed at exactly one thing: the side of every blade the sun cannot
   * reach. A leaf lit by one directional and one hemisphere has a lit face and
   * a face that falls to whatever the ambient's ground colour is, which is a
   * brown that reads as black. Real grass does not have that face, because the
   * field around it is throwing light back up into it.
   */
  readonly bounce: DirectionalLight;

  private readonly sky: SkyMaterial;
  private readonly skyBox: Mesh;
  private environment: HDRCubeTexture | null = null;
  /**
   * The sky, captured as the thing that lights the scene.
   *
   * <p>There were three separate opinions about what colour the sky was: this
   * `SkyMaterial`, which is a real atmosphere driven by turbidity and moves
   * correctly with the sun; a `HemisphericLight` with a hardcoded blue over a
   * hardcoded brown, hand-lerped toward orange by a dusk curve written to
   * imitate what the atmosphere was already computing; and an HDR photograph of
   * somebody else's sky at somebody else's time of day. The grass was lit by the
   * second and third while standing under the first, which is why no amount of
   * retuning the dusk curve ever made evening look right.
   *
   * <p>One opinion now. The probe renders the sky box into a cube map whenever
   * the clock moves, and that cube map is the scene's environment — so the
   * ambient light, the sky's own colour and the fog all come from the same
   * atmosphere. Babylon computes IBL irradiance in the vertex shader and
   * interpolates it, so this is cheaper per fragment than the light it replaces.
   */
  private readonly skyProbe: ReflectionProbe;
  /** Whether a spherical-harmonic readback is already queued for this frame. */
  private recomputing = false;
  /**
   * Temporal anti-aliasing, on the still frame only.
   *
   * <p>A field of grass is the canonical case for it: hundreds of thousands of
   * sub-pixel edges, every one of them crawling as the camera creeps. Multi-
   * sampling cannot reach that — the edges are smaller than a sample — and it
   * is the named first-order failure of every grass renderer that does without.
   *
   * <p>Jittered over sixteen frames, with each pixel's history clamped to the
   * range of its neighbours so a moving edge cannot smear, and switched off the
   * moment the camera moves. That last is the honest trade: reprojecting the
   * history properly wants a per-pixel velocity, a velocity buffer wants a
   * second geometry pass, and geometry is exactly what this board has no
   * headroom in. A board is looked at far more than it is flown around, so the
   * still frame is the one worth resolving.
   */
  private readonly taa: TAARenderingPipeline;
  private bloom: DefaultRenderingPipeline | null = null;
  private day = 196;
  private hour = 13;
  /** The camera's input map, for swapping what a left drag means. */
  private pan: PanMap | null = null;
  /** Whether the grade toggle is on, which the clock has to respect. */
  private graded = true;

  private constructor(
    readonly engine: WebGPUEngine,
    private readonly canvas: HTMLCanvasElement,
    private readonly look: BoardLook,
    private readonly indoor = false,
  ) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.55, 0.68, 0.82, 1);
    // Left-handed, which is Babylon's default, and the axis swap in
    // `toStage` is what converts our right-handed Z-up board into it.
    this.scene.useRightHandedSystem = false;

    this.camera = new ArcRotateCamera(
      'view', -Math.PI / 2, 1.05, 300, Vector3.Zero(), this.scene,
    );
    // `false`, and it matters: the second argument is *noPreventDefault*, so
    // passing `true` leaves the wheel event to the document and the page
    // scrolls away underneath while the camera zooms. The canvas also needs
    // `touch-action: none` for the same reason on a trackpad.
    this.camera.attachControl(canvas, false);
    this.camera.minZ = 1;
    this.camera.maxZ = 8000;
    this.camera.wheelDeltaPercentage = 0.04;
    this.camera.pinchDeltaPercentage = 0.02;
    this.camera.useNaturalPinchZoom = true;
    // Panning is in world units per pixel and Babylon does not scale it with
    // distance, so one number is either unusable across the whole board or
    // unusable standing in the grass. This keeps the *screen* distance
    // constant instead, which is what a hand expects from a map.
    this.scene.onBeforeRenderObservable.add(() => {
      this.camera.panningSensibility = Math.max(8, 4200 / Math.max(1, this.camera.radius));
    });
    // <b>Panning is an input map now, not a button number.</b> Babylon 9.26
    // replaced `panningMouseButton` and `useCtrlForPanning` with a declarative
    // table on `camera.movement.input`, and setting the old properties is a
    // silent no-op on an object that no longer reads them — which is exactly
    // what the first attempt at this did, and it appeared to work because
    // right-drag panning is in the *default* table.
    //
    // <p>What is not in the default table is shift-drag or the middle button,
    // and those are the two a map wants: a trackpad has no comfortable right
    // drag, and the middle button is what every other 3D tool uses. Right and
    // ctrl-left are already there and stay.
    this.pan = (this.camera as unknown as {
      movement?: { input?: PanMap };
    }).movement?.input ?? null;
    this.pan?.setInteraction('pointer', { button: 0, modifiers: { shift: true } }, 'pan');
    this.pan?.setInteraction('pointer', { button: 1 }, 'pan');
    // Right-drag pans, so the menu that would otherwise eat the gesture has to
    // go. Scoped to the canvas, which is the only place the gesture means this.
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    // <b>Panned, but not off the map.</b> A camera whose target can walk
    // anywhere ends up looking at nothing at all, and the way back is the
    // reset button rather than the mouse. The origin is set by `frame`, which
    // is the only thing that knows where the board is.
    this.camera.panningDistanceLimit = 400;
    this.camera.lowerBetaLimit = 0.05;
    // Just short of the horizon: past it the camera goes under the ground and
    // there is nothing down there to see.
    this.camera.upperBetaLimit = Math.PI / 2 - 0.02;

    this.sun = new DirectionalLight('sun', new Vector3(0, -1, 0), this.scene);
    // Stays at 2048. Halving it was measured and bought nothing at all — the
    // shadow pass here is bound by its draw calls, not its fill: forty terrain
    // chunks across four cascades is a hundred and sixty draws, and the map's
    // resolution does not change that number. The lever worth pulling, when it
    // is worth pulling one, is fewer casters or fewer cascades.
    this.shadows = new CascadedShadowGenerator(2048, this.sun);
    this.shadows.lambda = 0.9;
    // <b>Wide enough to hide the cascade seam.</b> At a twentieth the boundary
    // between two cascades is its own line across the ground, for the same
    // reason and with the same tell — it moves when the camera does.
    this.shadows.cascadeBlendPercentage = 0.15;
    this.shadows.stabilizeCascades = true;
    // <b>How far from the camera a surface may be and still be shadowed — and
    // it has to reach the far edge of the board.</b>
    //
    // <p>This was four hundred, on the reasoning that cascades fitted across
    // twice what anything casts across spend half their resolution on empty
    // air. True, and it drew a line across the middle of the map: past four
    // hundred there is no shadow term at all, so the far half of the board was
    // lit differently from the near half, with a hard horizontal edge between
    // them that slid up and down as the camera zoomed. Precisely the artifact
    // that a still screenshot from one distance cannot show.
    //
    // <p>Set from the board in {@link frame} instead, so it covers whatever the
    // camera can see of it however far back it stands.
    this.shadows.shadowMaxZ = 1200;
    this.shadows.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;
    this.shadows.usePercentageCloserFiltering = true;
    // The terrain is the only caster and it never moves, so the bounding info
    // it is fitted to can be computed once instead of every frame.
    this.shadows.freezeShadowCastersBoundingInfo = true;
    // <b>Two, not the default four.</b> Cascades exist to spend resolution
    // where it is looked at, and they cost in draw calls: forty terrain chunks
    // times four is a hundred and sixty, and the pass scales with that almost
    // exactly — 3.25 ms at four, 2.17 at three, 1.32 at two. What is left to
    // shadow is the terrain alone, which is large, smooth and has no small
    // casters on it since the meadow stopped both casting and receiving. Two
    // bands across four hundred half-feet is more than that needs.
    this.shadows.numCascades = 2;

    this.bounce = new DirectionalLight('bounce', new Vector3(0, -1, 0), this.scene);
    this.bounce.intensity = 0.3;
    this.bounce.diffuse = new Color3(0.40, 0.28, 0.20);
    this.bounce.specular = new Color3(0, 0, 0);

    this.ambient = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    this.ambient.diffuse = new Color3(0.62, 0.72, 0.9);
    this.ambient.groundColor = new Color3(0.28, 0.26, 0.2);

    // Indoors there is no sky to build, and the ambient that stands in for one
    // has to be nearly nothing — a crypt lit by a hemisphere light is a crypt
    // with the lights on, which is the whole thing the torches are for.
    if (indoor) {
      this.scene.clearColor = new Color4(0.02, 0.02, 0.03, 1);
      this.ambient.diffuse = new Color3(0.10, 0.11, 0.16);
      this.ambient.groundColor = new Color3(0.05, 0.045, 0.04);
      this.ambient.intensity = 0.18;
      this.sun.intensity = 0;
      this.bounce.intensity = 0;
      this.shadows.dispose();
    }

    this.sky = new SkyMaterial('sky', this.scene);
    this.sky.backFaceCulling = false;
    this.sky.useSunPosition = true;
    this.sky.turbidity = 6;
    this.sky.rayleigh = 1.6;
    this.sky.luminance = 1;
    this.skyBox = CreateBox('skyBox', { size: 6000 }, this.scene);
    this.skyBox.material = this.sky;
    this.skyBox.infiniteDistance = true;
    this.skyBox.setEnabled(!indoor);

    // 128 a face, float, linear. Float because a sky has a sun in it and the
    // sun is far brighter than white — clamped to eight bits the whole dome
    // flattens to one pale blue and the light it casts loses its direction.
    // Linear because everything downstream of it is.
    this.skyProbe = new ReflectionProbe('sky-probe', 128, this.scene, true, true, true);
    this.skyProbe.renderList?.push(this.skyBox);
    // Rendered on demand rather than every frame: the sky only changes when the
    // clock does, and `setClock` asks for it then.
    this.skyProbe.refreshRate = 0;
    if (!indoor) {
      this.scene.environmentTexture = this.skyProbe.cubeTexture;
      // <b>A quarter, not all of it.</b> Direct sun is roughly a hundred
      // thousand lux and the sky's own diffuse contribution roughly twenty, so
      // a sky lighting a field at full strength is four or five times its real
      // share — and it shows, because light arriving from every direction at
      // once has no shape. At 1.0 the meadow went pale mint and lost its
      // contrast; at a quarter it is deep green with the hill's form still in
      // it, which is both the better picture and the more nearly correct one.
      //
      // <p>Lower again now the plants are photographs. A scan already carries
      // the light it was shot under; lighting it a second time from every
      // direction at once is what was taking the green out of the field and
      // leaving it grey from above.
      //
      // <p><b>Back up again, because the field stopped reading it.</b> A tenth
      // was the right number while the meadow was lit by this as well; the
      // meadow opts out of image-based lighting entirely now, so all this
      // reaches is the ground, the stone and the scanned trees — the three
      // things with no self-shadowing of their own and the three that were
      // reading as flat cutouts against the sward. At 0.14 switching it off
      // changed nothing anybody could see, which is a toggle that lies.
      this.scene.environmentIntensity = 0.45;
      // The hemisphere is a fill under the sky now, not a stand-in for it. Low
      // and neutral: what it is still good for is keeping the underside of a
      // sward off zero, which an environment map alone does not do because the
      // grass does not occlude itself in it.
      this.ambient.intensity = 0.3;
      this.ambient.diffuse = new Color3(0.62, 0.7, 0.84);
      this.ambient.groundColor = new Color3(0.3, 0.29, 0.26);
    }

    // <b>No fog on this board, and there was not much reason for any.</b>
    //
    // <p>It was doing two jobs: dissolving the far edge of the field, and
    // hiding the seam where the sown window stopped. The window is gone — the
    // sward runs to the board's own edge now — and the first job is worth less
    // than it sounds, because this board is two hundred and twenty feet across
    // and real aerial perspective over two hundred feet is nothing.
    //
    // <p>It also measured 1.5 ms of a 7.1 ms meadow, which is more than the sun
    // costs. Fog is a per-fragment term and the sward is several cards deep over
    // every pixel from directly above, so it is paid once a layer rather than
    // once a pixel. Taking it off the meadow alone left the grass more saturated
    // than the ground it stands on, visible as a rim round the board; taking it
    // off everything is both cheaper and consistent.
    this.scene.fogMode = Scene.FOGMODE_NONE;

    // Before anything else on the camera: TAA has to be the first post process
    // in the chain or it resolves an image that has already been graded.
    this.taa = new TAARenderingPipeline('taa', this.scene, [this.camera]);
    this.taa.samples = 16;
    // <b>Sharper than it was, at the cost of some crawl.</b> `factor` is how
    // much of the new frame lands in the image, so 0.06 was a sixteen-frame
    // rolling average — and Babylon's temporal resolve reprojects with the
    // camera matrix alone, with no velocity buffer. Every blade on this board
    // moves in its own vertex shader from the wind, so every blade reprojects
    // to the wrong place and smears. Raising it shortens the tail.
    this.taa.factor = 0.16;
    // Clamp each pixel's history to the range of its eight neighbours. Without
    // it a still frame that is not quite still — the wind never stops — smears
    // rather than resolves.
    this.taa.clampHistory = true;
    // <b>No multisampling. It was three quarters of the frame.</b>
    //
    // <p>This said the opposite for a while, on a measurement that was reading
    // the wrong counter: `gpuTimeInFrameForMainPass` times the pass that
    // presents to the swap chain, and with this pipeline installed that pass is
    // the temporal resolve — a full-screen blit. The scene itself is drawn into
    // the pipeline's own render target, in a pass that counter never sees. So
    // every "the frame costs 5.8 ms" in this renderer's history was the cost of
    // the blit, and the number that matters was never being read.
    //
    // <p>Read honestly — wall clock between presents — four samples at this
    // board's 3472 x 1632 is 32.5 ms a frame and one sample is 8.3, which is
    // the display's own 120 Hz and therefore an upper bound rather than a cost.
    // Two samples measured identical to four, so the choice is not a dial: it is
    // multisampled or it is not. Twenty-four milliseconds is not a price worth
    // paying for edges, with a temporal resolve already in the chain to do it.
    this.taa.msaaSamples = 1;
    // <b>It stops resolving while the camera moves, and leaving it on was a
    // trade that did not exist.</b> The flag only gates the blend factor — the
    // sub-pixel jitter is separately switched off whenever the camera has
    // moved, and there is no velocity buffer. So running it through motion
    // blended eighty-four per cent history with no new samples and no
    // reprojection: a ghost trail bought for no anti-aliasing at all.
    this.taa.disableOnCameraMove = true;
    this.taa.isEnabled = !indoor;

    if (!indoor) {
      // <b>Bloom, and only bloom.</b> The default pipeline carries anti-
      // aliasing, depth of field, sharpening, grain and chromatic aberration as
      // well; every one of them is either already done better here or is a
      // filter on a board that wants to be read rather than photographed. What
      // it is here for is the one thing a low sun over a field actually does,
      // which is spill light around the bright edges of things.
      //
      // <p>After the temporal resolve in the chain, because bloom on a jittered
      // frame is bloom that flickers.
      this.bloom = new DefaultRenderingPipeline('bloom', true, this.scene, [this.camera]);
      this.bloom.fxaaEnabled = false;
      this.bloom.samples = 1;
      // <b>On, and switching it off turned the whole grade off everywhere.</b>
      // `imageProcessingEnabled` on this pipeline is not a local flag: its
      // setter writes `scene.imageProcessingConfiguration.isEnabled`, which is
      // the master switch every PBR material reads as well. Set to false the
      // day bloom shipped, it disabled tone mapping, contrast, exposure and
      // vignette for the entire board — so the grade toggle flipped settings
      // on a configuration that was not being applied, and reported nothing.
      //
      // <p>Enabled, the grade becomes one full-screen pass after bloom instead
      // of a term inside each material's shader, and that is the better place
      // for it for a second reason: <b>`SkyMaterial` does not do image
      // processing at all.</b> Graded in the materials, the sky was the one
      // surface in the frame that was never tone mapped — which is why bloom
      // read as a white wedge across the horizon rather than as light spilling
      // off anything. A sky several times brighter than white, blurred and
      // added back to an image with no highlight compression in front of it,
      // can only clip. The wedge is gone with no change to bloom's own
      // settings.
      this.bloom.imageProcessingEnabled = true;
      this.bloom.bloomEnabled = true;
      // High, because almost nothing on a meadow is bright enough to bloom and
      // the things that are — a low sun on wet grass, the sky at the horizon —
      // are the whole point. A low threshold blooms the entire field into soup.
      this.bloom.bloomThreshold = 0.86;
      this.bloom.bloomWeight = 0.34;
      this.bloom.bloomKernel = 32;
      // A quarter of the resolution. Bloom is a blur and a blur of a blur is
      // the same blur — at half it measured 1.8 ms, which is more than the sun
      // costs, for an effect that only appears at dusk.
      this.bloom.bloomScale = 0.25;

      // <b>No god rays, and they were tried.</b> Every screen-space effect
      // refused on this board was refused for needing the scene rendered a
      // second time, and this one looked like the exception: it renders
      // *occluders* into a fifth-resolution buffer with a black material, not
      // the whole scene. It is not the exception. Installed and doing nothing —
      // noon, sun off screen — the frame went from 15.7 ms to 22.9. The pass
      // runs whatever the sun is doing.
      //
      // <p>And it did not look right either. With the sky box as the light's
      // stand-in the whole frame floods white rather than throwing shafts,
      // because the occluder is the thing the rays are supposed to come *from*
      // and the sky is not an object. Making it work would want a small bright
      // quad at the sun's position, which is another mesh and another 7 ms
      // question.
    }

    const image = this.scene.imageProcessingConfiguration;
    image.toneMappingEnabled = true;
    // <b>Not ACES.</b> ACES is a film look built for wide-gamut input, and its
    // documented failure is hue skew in the highlights and desaturation — the
    // reported symptom being washed-out highlights and crushed blacks
    // *especially in foliage*, which is the entire content of this board.
    // Khronos published the neutral mapper to keep hue and saturation while
    // still taming highlights, and Babylon ships it.
    image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    image.contrast = look.contrast ?? 1;
    image.vignetteEnabled = (look.vignette ?? 0) > 0;
    image.vignetteWeight = (look.vignette ?? 0) * 4;
  }

  static async open(
    canvas: HTMLCanvasElement, look: BoardLook, environmentUrl?: string,
    indoor = false,
  ): Promise<Stage> {
    const engine = new WebGPUEngine(canvas, {
      // <b>No multisampling on the main pass, and asking for it was the same
      // twenty-four milliseconds arriving by the back door.</b> `antialias`
      // sets `_mainPassSampleCount` to four, which allocates a four-sample
      // colour target and a four-sample depth target at the full canvas — at
      // 3472 by 1632 that is about ninety megabytes each — and resolves them
      // every frame. With the temporal pipeline installed the scene is never
      // drawn there: it goes into the pipeline's own target, and the only thing
      // that touches the main pass is one full-screen blit with no edges in it.
      antialias: false,
      stencil: false,
      // The one number the old renderer had to fight for. Nothing here caps it
      // below the display's own, because nothing here is fill-bound any more.
      adaptToDeviceRatio: true,
      deviceDescriptor: {
        // What makes `EngineInstrumentation.captureGPUFrameTime` real. Babylon
        // filters this against what the adapter actually offers, so asking for
        // it costs nothing where it is missing — the counter reads zero and
        // the CPU-side numbers carry on.
        requiredFeatures: ['timestamp-query'],
      },
    });
    try {
      await engine.initAsync();
      // Has to be set once the device exists and before any frame: the query
      // pool is sized at that point, and turning it on later throws
      // "WebGPUDurationMeasure: index out of range" from inside a render pass.
      engine.enableGPUTimingMeasurements = true;
    } catch (error) {
      // Give the device back. A page that reloads onto a failed init half a
      // dozen times leaves that many adapters outstanding, and the next
      // `requestAdapter` then hangs with no error anywhere — which reads
      // exactly like the code being broken, and is not.
      engine.dispose();
      throw error;
    }
    const stage = new Stage(engine, canvas, look, indoor);
    if (environmentUrl) {
      stage.loadEnvironment(environmentUrl);
    }
    stage.setClock(look.hour ?? 13);
    return stage;
  }

  /**
   * Where the light in the scene comes from when nothing in it is making light.
   *
   * <p>A PBR material with no environment has no ambient specular at all, which
   * is the difference between ground and modelling clay. The theme's own sky
   * photograph, so the board is lit by the sky it is standing under.
   */
  private loadEnvironment(url: string): void {
    // <b>Outdoors this is not used.</b> The sky probe is the environment there,
    // because a photograph of one sky cannot agree with an atmosphere that
    // moves. It stays for the indoor boards, which have no sky to capture.
    if (!this.indoor) {
      return;
    }
    const resolved = assetUrl(url);
    this.environment = new HDRCubeTexture(resolved, this.scene, 128);
    this.scene.environmentTexture = this.environment;
    this.scene.environmentIntensity = 1;
  }

  /**
   * Moves the sun to an hour of the day.
   *
   * <p>Everything here follows from `sunPosition`: the light's direction, its
   * colour and strength, the sky's own sun, and the exposure an eye would
   * settle on. One number in, a whole time of day out — which is the reason
   * that file survived the port unchanged.
   */
  /**
   * Moves the board through the year.
   *
   * <p>Only the sun's own arithmetic lives here: where it rises, how high it
   * gets at noon, how long the day is. What the field does about it is the
   * meadow's business.
   */
  setDay(day: number): void {
    this.day = Math.max(1, Math.min(365, Math.round(day)));
    this.setClock(this.hour);
  }

  setClock(hour: number): void {
    this.hour = hour;
    if (this.indoor) {
      return;
    }
    const { elevation, azimuth } = sunPosition(
      hour, this.look.latitude ?? 37.5, this.day,
    );
    const flat = Math.cos(elevation * RAD);
    // Board axes: x east, y north, z up. Bearings run clockwise from north.
    const east = flat * Math.sin(azimuth * RAD);
    const north = flat * Math.cos(azimuth * RAD);
    const up = Math.sin(elevation * RAD);
    // ...and the stage is y-up, so the same swap the terrain uses.
    const toward = new Vector3(east, up, north);

    this.sun.direction = toward.scale(-1);
    const { intensity, color } = sunlight(elevation);
    const sunColor = Color3.FromHexString(
      `#${color.toString(16).padStart(6, '0')}`,
    );
    this.sun.intensity = Math.max(0, intensity);
    this.sun.diffuse = sunColor;
    this.sun.specular = sunColor;
    this.sky.sunPosition = toward.scale(100);

    // The bounce comes back the way the sun went: the sun's horizontal
    // direction reversed and flattened onto the horizon. Flat, because light
    // leaving the ground leaves it upward and the part that matters for a blade
    // is the part arriving sideways.
    this.bounce.direction = flat === 0
      ? new Vector3(0, -1, 0)
      : new Vector3(east, 0, north).normalize();
    // It is sunlight, so it goes out with the sun, and it carries the ground's
    // colour rather than the sun's.
    this.bounce.intensity = 0.34 * Math.max(0, Math.min(1, intensity));

    // How far into evening this is: nothing above twenty-five degrees, all the
    // way at the horizon. Everything below hangs off it, because everything
    // below has the same cause — light arriving through more air.
    const dusk = Math.max(0, Math.min(1, 1 - Math.max(0, elevation) / 25));

    // <b>The sky has to travel with the sun.</b> Left at one setting it simply
    // greys as the sun drops, which is what a photograph of dusk looks like
    // with the white balance nailed to noon. Turbidity is how much haze the
    // light is crossing, and it is the whole reason a low sun is orange.
    this.sky.turbidity = 2.2 + 9 * dusk;
    this.sky.rayleigh = 1.5 + 1.1 * dusk;
    this.sky.luminance = 1 - 0.4 * dusk;
    this.sky.mieDirectionalG = 0.8 - 0.1 * dusk;

    // <b>The sky is re-captured, and the ambient is not hand-lerped any more.</b>
    // Whatever the atmosphere above now looks like is what lights the field:
    // warm at dusk because the sky is warm at dusk, without a curve here
    // guessing at it. The polynomial recompute is the load-bearing half — the
    // cube map's own pixels update on their own, and the diffuse irradiance
    // derived from them does not unless it is asked.
    //
    // <p><b>Coalesced to one a frame, because the hour slider fires on every
    // pixel of a drag.</b> Recomputing the polynomial reads all six faces of
    // the cube back to the CPU, and a PBR material is not ready while that read
    // is outstanding — so dragging the clock dropped the terrain out of the
    // frame, once per mouse move. The probe itself is cheap to re-render; it is
    // the readback that is not, and one per frame is as often as it can
    // possibly matter.
    this.skyProbe.cubeTexture.resetRefreshCounter();
    if (!this.recomputing) {
      this.recomputing = true;
      this.scene.onAfterRenderObservable.addOnce(() => {
        this.recomputing = false;
        this.skyProbe.cubeTexture.forceSphericalPolynomialsRecompute();
      });
    }
    // <b>The hemisphere is the meadow's whole ambient now.</b> It used to be a
    // small fill under the sky probe, because the probe was lighting the field
    // as well. The meadow does not read the probe any more — it was 2.2 ms of a
    // 7.1 ms field for a term sitting at 0.14 — so what the sky was contributing
    // has to come from here instead. It still dims with the sun.
    this.ambient.intensity = 0.12 + 0.2 * Math.max(0, up);

    // <b>Adaptation, but only part of it.</b> `eyeExposure` returns the full
    // ratio an eye would settle on — about 2.7x at half past five — and
    // applying all of it turns evening back into afternoon: the same picture,
    // paler, with the warmth washed out of it. A real eye does open up, and a
    // real evening is still visibly evening. The root keeps the direction of
    // the adjustment and drops most of its size.
    this.scene.imageProcessingConfiguration.exposure = this.graded
      ? (this.look.exposure ?? 1) * Math.pow(eyeExposure(elevation), 0.45)
      : 1;

    // Kept with the clock although nothing reads it today — `SkyMaterial`
    // gates its own fog on `fogMode`, which is NONE. It is two lerps a tick and
    // it is the value anything that wants aerial perspective later would want.
    this.scene.fogColor = Color3.Lerp(
      new Color3(0.64, 0.72, 0.82), new Color3(0.58, 0.45, 0.37), dusk,
    );
  }

  /**
   * The switches the board's toggle row throws.
   *
   * <p>Each is the smallest change that makes one piece of work stop happening,
   * so it can be judged against the same frame a second earlier. They are here
   * rather than in the component because every one of them is a fact about the
   * stage that the component has no business knowing.
   */
  setShadows(on: boolean): void {
    // The shadow map is sampled by whatever receives it; emptying the render
    // list is not enough, because an unwritten map reads as all shadow. The
    // generator's own switch is.
    this.shadows.getShadowMap()!.renderList!.forEach(mesh => {
      mesh.receiveShadows = false;
    });
    this.sun.shadowEnabled = on;
    this.terrainReceives(on);
  }

  private terrainReceives(on: boolean): void {
    this.shadows.getShadowMap()?.renderList?.forEach(mesh => {
      mesh.receiveShadows = on && mesh.layerMask !== 0x20000000;
    });
  }

  setResolve(on: boolean): void {
    this.taa.isEnabled = on && !this.indoor;
  }

  setRelief(on: boolean): void {
    // Normal and roughness maps on the ground. Both live on the terrain's own
    // material, which is whatever the first chunk is wearing.
    for (const mesh of this.scene.meshes) {
      const material = mesh.material as unknown as {
        bumpTexture?: unknown; metallicTexture?: unknown;
        _relief?: unknown; _surface?: unknown;
        markAsDirty?: (flag: number) => void;
      } | null;
      if (!material || !mesh.name.startsWith('ground-')) {
        continue;
      }
      if (on) {
        material.bumpTexture = material._relief ?? material.bumpTexture;
        material.metallicTexture = material._surface ?? material.metallicTexture;
      } else {
        material._relief ??= material.bumpTexture;
        material._surface ??= material.metallicTexture;
        material.bumpTexture = null;
        material.metallicTexture = null;
      }
    }
  }

  setSkyLight(on: boolean): void {
    this.scene.environmentTexture = on && !this.indoor
      ? this.skyProbe.cubeTexture : null;
  }

  setBloom(on: boolean): void {
    if (this.bloom) {
      this.bloom.bloomEnabled = on;
    }
  }

  /**
   * Moves everything that is not the sward along with the year.
   *
   * <p>The meadow browns itself in its own compute pass, and a board where only
   * the grass knows what month it is looks worse than one where nothing does:
   * green blades over summer-green ground under summer-green trees, all
   * disagreeing. The ground and the scanned plants are photographs and cannot
   * be re-shot, so they are tinted — a fawn multiply, which is what a dry
   * season does to everything anyway.
   */
  setSeasonTint(green: number): void {
    const dry = 1 - Math.max(0, Math.min(1, green));
    const tint = new Color3(
      1 + dry * 0.10, 1 - dry * 0.10, 1 - dry * 0.34,
    );
    for (const mesh of this.scene.meshes) {
      if (!/^ground-|^scan-/.test(mesh.name)) {
        continue;
      }
      // A merged scan wears a `MultiMaterial` — bark, leaves and twigs are
      // separate materials in the glTF — and that has no albedo of its own,
      // so the tint has to reach its parts. Left unhandled, the one tree on
      // the board with three materials was the one tree that stayed July green
      // in November.
      const worn = mesh.material as unknown as {
        albedoColor?: Color3; subMaterials?: ({ albedoColor?: Color3 } | null)[];
      } | null;
      for (const material of worn?.subMaterials ?? [worn]) {
        if (material?.albedoColor) {
          material.albedoColor = tint;
        }
      }
    }
  }

  setGrade(on: boolean): void {
    this.graded = on;
    const image = this.scene.imageProcessingConfiguration;
    image.toneMappingEnabled = on;
    image.contrast = on ? (this.look.contrast ?? 1) : 1;
    image.vignetteEnabled = on && (this.look.vignette ?? 0) > 0;
    // Exposure is written by the clock, so it has to be rewritten here rather
    // than set — otherwise the next tick of the hour slider puts it back.
    this.setClock(this.hour);
  }

  /**
   * Whether dragging with the left button pans instead of orbiting.
   *
   * <p>For a one-button mouse and for anyone who thinks of this as a map
   * rather than as a model. Right-drag pans in either mode, so this only ever
   * adds a way in.
   */
  setPanMode(on: boolean): void {
    this.pan?.setInteraction('pointer', { button: 0 }, on ? 'pan' : 'rotate');
  }

  /** Frames the whole board. */
  frame(atX: number, atY: number, atZ: number, spanHalfFeet: number): void {
    this.camera.setTarget(new Vector3(atX, atZ, atY));
    // <b>Fitted to the viewport, not to a constant.</b> `spanHalfFeet * 1.15`
    // was tuned against a canvas that had four rows of controls stacked over
    // it; given the whole window the same radius leaves the board a postage
    // stamp in the middle of a lot of sky. Babylon's fov is vertical, so a
    // wide window is limited by height and a tall one by width.
    // Babylon's fov is vertical, so the horizontal one follows the aspect. The
    // board's on-screen footprint is its width by its depth *laid down* — at a
    // low angle the depth is foreshortened almost to nothing and the width is
    // the only constraint, and looking straight down it is the other way round.
    const aspect = this.engine.getAspectRatio(this.camera) || 1;
    const tall = Math.tan(this.camera.fov / 2);
    const wide = tall * aspect;
    const half = spanHalfFeet / 2;
    const laid = Math.max(0.2, Math.cos(this.camera.beta));
    this.camera.radius = Math.max(half / wide, (half * laid) / tall) * 1.3;
    // Panning is measured from wherever the board turned out to be, and how
    // far you may wander from it scales with how big the board is.
    this.camera.panningOriginTarget = new Vector3(atX, atZ, atY);
    this.camera.panningDistanceLimit = spanHalfFeet * 1.1;
    // The shadowed range has to reach the far corner from wherever the camera
    // ends up, or the board is lit in two halves with a line between them.
    // Twice the span covers standing back far enough to frame it and then
    // looking across the whole thing.
    this.shadows.shadowMaxZ = Math.max(400, spanHalfFeet * 2.6);
  }

  start(): void {
    this.engine.runRenderLoop(() => this.scene.render());
  }

  resize(): void {
    this.engine.resize();
  }

  dispose(): void {
    this.engine.stopRenderLoop();
    this.taa.dispose();
    this.skyProbe.dispose();
    this.environment?.dispose();
    this.skyBox.dispose();
    this.sky.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
