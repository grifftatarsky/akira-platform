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
import { Scene } from '@babylonjs/core/scene';
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

    // <b>Aerial perspective, which the board had none of.</b> The far end of a
    // two-hundred-foot field is not the same colour as the near end, and fog is
    // the cheapest depth cue in real-time rendering — one exponential and a
    // colour. The colour is set with the clock, because fog that does not
    // match the sky it is standing in front of reads as a grey wash.
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.0009;

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

    // The ambient stands in for the whole sky, so it cannot stay the same cool
    // blue all evening — at six the sky over a field *is* the warm half of the
    // light, and a blue fill under an orange sun is what made the grass read
    // as midday green at half past five.
    this.ambient.diffuse = Color3.Lerp(
      new Color3(0.62, 0.72, 0.9), new Color3(0.55, 0.42, 0.36), dusk,
    );
    this.ambient.groundColor = Color3.Lerp(
      new Color3(0.28, 0.26, 0.2), new Color3(0.16, 0.12, 0.1), dusk,
    );
    this.ambient.intensity = (0.3 + 0.45 * Math.max(0, up)) * (1 - 0.5 * dusk);

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
    this.scene.fogDensity = 0.0008 + 0.0009 * dusk;
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
    this.environment?.dispose();
    this.skyBox.dispose();
    this.sky.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
