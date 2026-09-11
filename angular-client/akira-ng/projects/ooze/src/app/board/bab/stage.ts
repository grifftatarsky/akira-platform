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
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import type { BoardLook } from '../board-assets';
import { eyeExposure, sunPosition, sunlight } from '../sun-position';
import { assetUrl } from './assets';

const RAD = Math.PI / 180;

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
    this.shadows.cascadeBlendPercentage = 0.05;
    this.shadows.stabilizeCascades = true;
    // Four hundred half-feet, not nine hundred. Cascades are fitted across
    // this range, so a range twice what anything casts across spends half its
    // resolution on empty air.
    this.shadows.shadowMaxZ = 400;
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
      this.scene.environmentIntensity = 0.14;
      // The hemisphere is a fill under the sky now, not a stand-in for it. Low
      // and neutral: what it is still good for is keeping the underside of a
      // sward off zero, which an environment map alone does not do because the
      // grass does not occlude itself in it.
      this.ambient.intensity = 0.3;
      this.ambient.diffuse = new Color3(0.62, 0.7, 0.84);
      this.ambient.groundColor = new Color3(0.3, 0.29, 0.26);
    }

    // <b>Aerial perspective, which the board had none of.</b> The far end of a
    // two-hundred-foot field is not the same colour as the near end, and fog is
    // the cheapest depth cue in real-time rendering — one exponential and a
    // colour. The colour is set with the clock, because fog that does not
    // match the sky it is standing in front of reads as a grey wash.
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.0004;

    // Before anything else on the camera: TAA has to be the first post process
    // in the chain or it resolves an image that has already been graded.
    this.taa = new TAARenderingPipeline('taa', this.scene, [this.camera]);
    this.taa.samples = 16;
    this.taa.factor = 0.06;
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
    // <b>And it keeps resolving while the camera moves.</b> Switching off in
    // motion was defensible when multisampling was underneath to catch it.
    // Nothing is underneath now, and a board being panned is exactly when a
    // field of sub-pixel edges crawls worst. `clampHistory` is what makes this
    // safe: a reprojected pixel that disagrees with its neighbours is thrown
    // away rather than smeared.
    this.taa.disableOnCameraMove = false;
    this.taa.isEnabled = !indoor;

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
      antialias: true,
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
  setClock(hour: number): void {
    if (this.indoor) {
      return;
    }
    const { elevation, azimuth } = sunPosition(
      hour, this.look.latitude ?? 37.5, this.look.dayOfYear ?? 196,
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
    this.skyProbe.cubeTexture.resetRefreshCounter();
    this.scene.onAfterRenderObservable.addOnce(() => {
      this.skyProbe.cubeTexture.forceSphericalPolynomialsRecompute();
    });
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
    this.scene.imageProcessingConfiguration.exposure =
      (this.look.exposure ?? 1) * Math.pow(eyeExposure(elevation), 0.45);

    // Fog is the sky at the horizon, so the far end of the field dissolves into
    // the thing behind it rather than into a grey. Warmer and heavier at dusk,
    // for the same reason the sky is: more air in the way.
    this.scene.fogColor = Color3.Lerp(
      new Color3(0.64, 0.72, 0.82), new Color3(0.58, 0.45, 0.37), dusk,
    );
    // <b>Strong enough to be doing something.</b> It was 0.0008, and exponential-
    // squared fog at that density is `exp(-(400 * 0.0008)^2)` at the board's far
    // edge — 0.90, which is to say nothing at all. The far grass then sat at
    // half the brightness of the near grass with nothing to lift it, and read
    // as a dark band along the horizon. At 0.0018 the same far edge is 0.60 and
    // the field recedes into the sky it is standing under, which is what aerial
    // perspective is for. The near field is untouched: at thirty half-feet the
    // factor is 0.997.
    // <b>A third of what it was.</b> Fog was doing two jobs: dissolving the far
    // edge of the board, and hiding the seam where the sown window stopped.
    // There is no window any more — the sward runs to the board's own edge — so
    // all that is left is the first job, and at the old density the whole field
    // went grey from directly above, which is the camera this game is played
    // from.
    this.scene.fogDensity = 0.0004 + 0.0009 * dusk;
  }

  /** Frames the whole board. */
  frame(atX: number, atY: number, atZ: number, spanHalfFeet: number): void {
    this.camera.setTarget(new Vector3(atX, atZ, atY));
    this.camera.radius = spanHalfFeet * 1.15;
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
