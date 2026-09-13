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

import '@babylonjs/core/Materials/Textures/baseTexture.polynomial';

import { SkyMaterial } from '@babylonjs/materials/sky/skyMaterial';
import type { BoardLook } from '../board-assets';
import { eyeExposure, sunPosition, sunlight } from '../sun-position';
import { assetUrl } from './assets';

const RAD = Math.PI / 180;

interface PanMap {
  setInteraction(
    source: string,
    conditions: { button?: number; modifiers?: Record<string, boolean> },
    interaction: string,
  ): boolean;
}

export class Stage {

  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly sun: DirectionalLight;
  readonly shadows: CascadedShadowGenerator;
  readonly ambient: HemisphericLight;

  readonly bounce: DirectionalLight;

  private readonly sky: SkyMaterial;
  private readonly skyBox: Mesh;
  private environment: HDRCubeTexture | null = null;

  private readonly skyProbe: ReflectionProbe;

  private recomputing = false;

  private readonly taa: TAARenderingPipeline;
  private bloom: DefaultRenderingPipeline | null = null;
  private day = 196;
  private hour = 13;

  private pan: PanMap | null = null;

  private graded = true;

  private constructor(
    readonly engine: WebGPUEngine,
    private readonly canvas: HTMLCanvasElement,
    private readonly look: BoardLook,
    private readonly indoor = false,
  ) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.55, 0.68, 0.82, 1);

    this.scene.useRightHandedSystem = false;

    this.camera = new ArcRotateCamera(
      'view', -Math.PI / 2, 1.05, 300, Vector3.Zero(), this.scene,
    );

    this.camera.attachControl(canvas, false);
    this.camera.minZ = 1;
    this.camera.maxZ = 8000;
    this.camera.wheelDeltaPercentage = 0.04;
    this.camera.pinchDeltaPercentage = 0.02;
    this.camera.useNaturalPinchZoom = true;

    this.scene.onBeforeRenderObservable.add(() => {
      this.camera.panningSensibility = Math.max(8, 4200 / Math.max(1, this.camera.radius));
    });

    this.pan = (this.camera as unknown as {
      movement?: { input?: PanMap };
    }).movement?.input ?? null;
    this.pan?.setInteraction('pointer', { button: 0, modifiers: { shift: true } }, 'pan');
    this.pan?.setInteraction('pointer', { button: 1 }, 'pan');

    canvas.addEventListener('contextmenu', event => event.preventDefault());

    this.camera.panningDistanceLimit = 400;
    this.camera.lowerBetaLimit = 0.05;

    this.camera.upperBetaLimit = Math.PI / 2 - 0.02;

    this.sun = new DirectionalLight('sun', new Vector3(0, -1, 0), this.scene);

    this.shadows = new CascadedShadowGenerator(2048, this.sun);
    this.shadows.lambda = 0.9;

    this.shadows.cascadeBlendPercentage = 0.15;
    this.shadows.stabilizeCascades = true;

    this.shadows.shadowMaxZ = 1200;
    this.shadows.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;
    this.shadows.usePercentageCloserFiltering = true;

    this.shadows.freezeShadowCastersBoundingInfo = true;

    this.shadows.numCascades = 2;

    this.bounce = new DirectionalLight('bounce', new Vector3(0, -1, 0), this.scene);
    this.bounce.intensity = 0.3;
    this.bounce.diffuse = new Color3(0.40, 0.28, 0.20);
    this.bounce.specular = new Color3(0, 0, 0);

    this.ambient = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    this.ambient.diffuse = new Color3(0.62, 0.72, 0.9);
    this.ambient.groundColor = new Color3(0.28, 0.26, 0.2);

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

    this.skyProbe = new ReflectionProbe('sky-probe', 128, this.scene, true, true, true);
    this.skyProbe.renderList?.push(this.skyBox);

    this.skyProbe.refreshRate = 0;
    if (!indoor) {
      this.scene.environmentTexture = this.skyProbe.cubeTexture;

      this.scene.environmentIntensity = 0.45;

      this.ambient.intensity = 0.3;
      this.ambient.diffuse = new Color3(0.62, 0.7, 0.84);
      this.ambient.groundColor = new Color3(0.3, 0.29, 0.26);
    }

    this.scene.fogMode = Scene.FOGMODE_NONE;

    this.taa = new TAARenderingPipeline('taa', this.scene, [this.camera]);
    this.taa.samples = 16;

    this.taa.factor = 0.16;

    this.taa.clampHistory = true;

    this.taa.msaaSamples = 1;

    this.taa.disableOnCameraMove = true;
    this.taa.isEnabled = !indoor;

    if (!indoor) {

      this.bloom = new DefaultRenderingPipeline('bloom', true, this.scene, [this.camera]);
      this.bloom.fxaaEnabled = false;
      this.bloom.samples = 1;

      this.bloom.imageProcessingEnabled = true;

      this.bloom.bloomEnabled = false;

      this.bloom.bloomThreshold = 0.86;
      this.bloom.bloomWeight = 0.34;
      this.bloom.bloomKernel = 32;

      this.bloom.bloomScale = 0.25;

    }

    const image = this.scene.imageProcessingConfiguration;
    image.toneMappingEnabled = true;

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

      antialias: false,
      stencil: false,

      adaptToDeviceRatio: true,
      deviceDescriptor: {

        requiredFeatures: ['timestamp-query'],
      },
    });
    try {
      await engine.initAsync();

      engine.enableGPUTimingMeasurements = true;
    } catch (error) {

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

  private loadEnvironment(url: string): void {

    if (!this.indoor) {
      return;
    }
    const resolved = assetUrl(url);
    this.environment = new HDRCubeTexture(resolved, this.scene, 128);
    this.scene.environmentTexture = this.environment;
    this.scene.environmentIntensity = 1;
  }

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

    const east = flat * Math.sin(azimuth * RAD);
    const north = flat * Math.cos(azimuth * RAD);
    const up = Math.sin(elevation * RAD);

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

    this.bounce.direction = flat === 0
      ? new Vector3(0, -1, 0)
      : new Vector3(east, 0, north).normalize();

    this.bounce.intensity = 0.34 * Math.max(0, Math.min(1, intensity));

    const dusk = Math.max(0, Math.min(1, 1 - Math.max(0, elevation) / 25));

    this.sky.turbidity = 2.2 + 9 * dusk;
    this.sky.rayleigh = 1.5 + 1.1 * dusk;
    this.sky.luminance = 1 - 0.4 * dusk;
    this.sky.mieDirectionalG = 0.8 - 0.1 * dusk;

    this.skyProbe.cubeTexture.resetRefreshCounter();
    if (!this.recomputing) {
      this.recomputing = true;
      this.scene.onAfterRenderObservable.addOnce(() => {
        this.recomputing = false;
        this.skyProbe.cubeTexture.forceSphericalPolynomialsRecompute();
      });
    }

    this.ambient.intensity = 0.12 + 0.2 * Math.max(0, up);

    this.scene.imageProcessingConfiguration.exposure = this.graded
      ? (this.look.exposure ?? 1) * Math.pow(eyeExposure(elevation), 0.45)
      : 1;

    this.scene.fogColor = Color3.Lerp(
      new Color3(0.64, 0.72, 0.82), new Color3(0.58, 0.45, 0.37), dusk,
    );
  }

  setShadows(on: boolean): void {

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

  setSkyDome(on: boolean): void {
    this.skyBox.setEnabled(on && !this.indoor);
  }

  setBloom(on: boolean): void {
    if (this.bloom) {
      this.bloom.bloomEnabled = on;
    }
  }

  setSeasonTint(green: number): void {
    const dry = 1 - Math.max(0, Math.min(1, green));
    const tint = new Color3(
      1 + dry * 0.10, 1 - dry * 0.10, 1 - dry * 0.34,
    );
    for (const mesh of this.scene.meshes) {
      if (!/^ground-|^scan-/.test(mesh.name)) {
        continue;
      }

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

    this.setClock(this.hour);
  }

  setPanMode(on: boolean): void {
    this.pan?.setInteraction('pointer', { button: 0 }, on ? 'pan' : 'rotate');
  }

  frame(atX: number, atY: number, atZ: number, spanHalfFeet: number): void {
    this.camera.setTarget(new Vector3(atX, atZ, atY));

    const aspect = this.engine.getAspectRatio(this.camera) || 1;
    const tall = Math.tan(this.camera.fov / 2);
    const wide = tall * aspect;
    const half = spanHalfFeet / 2;
    const laid = Math.max(0.2, Math.cos(this.camera.beta));
    this.camera.radius = Math.max(half / wide, (half * laid) / tall) * 1.3;

    this.camera.panningOriginTarget = new Vector3(atX, atZ, atY);
    this.camera.panningDistanceLimit = spanHalfFeet * 1.1;

    this.shadows.shadowMaxZ = Math.max(400, spanHalfFeet * 2.6);
  }

  jitter(on: boolean): void {
    this.taa.isEnabled = on;
  }

  jittering(): boolean {
    return this.taa.isEnabled;
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
