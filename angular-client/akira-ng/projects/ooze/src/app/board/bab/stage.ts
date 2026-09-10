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

  private readonly sky: SkyMaterial;
  private readonly skyBox: Mesh;
  private environment: HDRCubeTexture | null = null;

  private constructor(
    readonly engine: WebGPUEngine,
    private readonly canvas: HTMLCanvasElement,
    private readonly look: BoardLook,
  ) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.55, 0.68, 0.82, 1);
    // Left-handed, which is Babylon's default, and the axis swap in
    // `toStage` is what converts our right-handed Z-up board into it.
    this.scene.useRightHandedSystem = false;

    this.camera = new ArcRotateCamera(
      'view', -Math.PI / 2, 1.05, 300, Vector3.Zero(), this.scene,
    );
    this.camera.attachControl(canvas, true);
    this.camera.minZ = 1;
    this.camera.maxZ = 8000;
    this.camera.wheelDeltaPercentage = 0.02;
    this.camera.panningSensibility = 12;
    this.camera.lowerBetaLimit = 0.05;
    // Just short of the horizon: past it the camera goes under the ground and
    // there is nothing down there to see.
    this.camera.upperBetaLimit = Math.PI / 2 - 0.02;

    this.sun = new DirectionalLight('sun', new Vector3(0, -1, 0), this.scene);
    this.shadows = new CascadedShadowGenerator(2048, this.sun);
    this.shadows.lambda = 0.9;
    this.shadows.cascadeBlendPercentage = 0.05;
    this.shadows.stabilizeCascades = true;
    this.shadows.shadowMaxZ = 900;
    this.shadows.filteringQuality = CascadedShadowGenerator.QUALITY_HIGH;
    this.shadows.usePercentageCloserFiltering = true;

    this.ambient = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    this.ambient.diffuse = new Color3(0.62, 0.72, 0.9);
    this.ambient.groundColor = new Color3(0.28, 0.26, 0.2);

    this.sky = new SkyMaterial('sky', this.scene);
    this.sky.backFaceCulling = false;
    this.sky.useSunPosition = true;
    this.sky.turbidity = 6;
    this.sky.rayleigh = 1.6;
    this.sky.luminance = 1;
    this.skyBox = CreateBox('skyBox', { size: 6000 }, this.scene);
    this.skyBox.material = this.sky;
    this.skyBox.infiniteDistance = true;

    const image = this.scene.imageProcessingConfiguration;
    image.toneMappingEnabled = true;
    image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    image.contrast = look.contrast ?? 1;
    image.vignetteEnabled = (look.vignette ?? 0) > 0;
    image.vignetteWeight = (look.vignette ?? 0) * 4;
  }

  static async open(
    canvas: HTMLCanvasElement, look: BoardLook, environmentUrl?: string,
  ): Promise<Stage> {
    const engine = new WebGPUEngine(canvas, {
      antialias: true,
      stencil: false,
      // The one number the old renderer had to fight for. Nothing here caps it
      // below the display's own, because nothing here is fill-bound any more.
      adaptToDeviceRatio: true,
    });
    try {
      await engine.initAsync();
    } catch (error) {
      // Give the device back. A page that reloads onto a failed init half a
      // dozen times leaves that many adapters outstanding, and the next
      // `requestAdapter` then hangs with no error anywhere — which reads
      // exactly like the code being broken, and is not.
      engine.dispose();
      throw error;
    }
    const stage = new Stage(engine, canvas, look);
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
    this.sun.intensity = Math.max(0, intensity);
    this.sun.diffuse = Color3.FromHexString(
      `#${color.toString(16).padStart(6, '0')}`,
    );
    this.sky.sunPosition = toward.scale(100);
    this.scene.imageProcessingConfiguration.exposure =
      (this.look.exposure ?? 1) * eyeExposure(elevation);
    this.ambient.intensity = 0.35 + 0.45 * Math.max(0, up);
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
