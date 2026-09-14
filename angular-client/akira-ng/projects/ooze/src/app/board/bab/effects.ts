import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import { VolumetricLightScatteringPostProcess } from '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess';

import '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';

import type { Stage } from './stage';

const SUN_LAYER = 0x40000000;

const SUN_REACH = 3000;

const SUN_SPAN = 150;

let masked = false;

async function maskSky(): Promise<void> {
  if (masked) {
    return;
  }
  await import('@babylonjs/core/ShadersWGSL/ssao2.fragment');
  const store = ShaderStore.ShadersStoreWGSL as Record<string, string>;
  const source = store['ssao2PixelShader'];
  if (!source) {
    throw new Error('ssao2PixelShader is not in the WGSL shader store');
  }
  const readNormal =
    'var normal: vec3f=normalize(textureSampleLevel(normalSampler,normalSamplerSampler,input.vUV,0.0).rgb);';
  const guarded =
    'var normalRaw: vec3f=textureSampleLevel(normalSampler,normalSamplerSampler,input.vUV,0.0).rgb;'
    + 'var normalLen: f32=length(normalRaw);'
    + 'var skyMask: f32=select(0.0,1.0,normalLen>1e-4);'
    + 'var normal: vec3f=select(vec3f(0.0,0.0,1.0),normalRaw/max(normalLen,1e-4),normalLen>1e-4);';
  const shade = 'var ao: f32=1.0-uniforms.totalStrength*occlusion*uniforms.samplesFactor;';
  const shadeMasked = 'var ao: f32=1.0-uniforms.totalStrength*occlusion*uniforms.samplesFactor*skyMask;';
  if (!source.includes(readNormal) || !source.includes(shade)) {
    throw new Error('ssao2PixelShader no longer matches the sky-mask patch');
  }
  store['ssao2PixelShader'] = source
    .replace(readNormal, guarded)
    .replace(shade, shadeMasked);
  masked = true;
}

export class Effects {

  private ao: SSAO2RenderingPipeline | null = null;
  private rays: VolumetricLightScatteringPostProcess | null = null;
  private disc: Mesh | null = null;
  private paint: PBRMaterial | null = null;
  private aiming: (() => void) | null = null;

  private solid: Mesh[] = [];
  private grass: Mesh[] = [];
  private sheet: Mesh[] = [];

  private shading = false;
  private fromSelf = true;

  private aoBusy = false;

  private overGrass = false;

  constructor(private readonly stage: Stage) { }

  standing(solid: Mesh[], grass: Mesh[], sheet: Mesh[]): void {
    this.solid = solid;
    this.grass = grass;
    this.sheet = sheet;
    this.aoReach();
    if (this.rays) {
      this.rays.getPass().renderList = [this.disc!, ...this.solid];
    }
  }

  private aoReach(): void {
    const gbuffer = this.stage.scene.geometryBufferRenderer;
    if (gbuffer) {
      gbuffer.renderList = this.overGrass ? null : this.solid as AbstractMesh[];
    }
  }

  setAoOverGrass(on: boolean): void {
    this.overGrass = on;
    this.aoReach();
  }

  async setAmbientOcclusion(on: boolean): Promise<void> {
    if (this.aoBusy) {
      return;
    }
    if (!on) {
      this.ao?.dispose();
      this.ao = null;
      this.stage.scene.disableGeometryBufferRenderer();
      return;
    }
    if (this.ao) {
      return;
    }
    this.aoBusy = true;
    try {
      await maskSky();
      const pipeline = new SSAO2RenderingPipeline(
        'ao', this.stage.scene, { ssaoRatio: 0.5, blurRatio: 1.0 },
        [this.stage.camera], true,
      );
      pipeline.radius = 3.5;
      pipeline.totalStrength = 1.0;
      pipeline.base = 0.1;
      pipeline.samples = 16;
      pipeline.maxZ = 400;
      pipeline.minZAspect = 0.3;
      pipeline.expensiveBlur = false;
      this.ao = pipeline;
      this.aoReach();
    } finally {
      this.aoBusy = false;
    }
  }

  aoOn(): boolean {
    return !!this.ao;
  }

  setGodRays(on: boolean): void {
    if (!on) {
      this.stop();
      return;
    }
    if (this.rays) {
      return;
    }
    const scene = this.stage.scene;
    const disc = CreateDisc('sun-disc', { radius: SUN_SPAN / 2, tessellation: 24 }, scene);
    disc.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;
    disc.layerMask = SUN_LAYER;
    disc.isPickable = false;
    disc.alwaysSelectAsActiveMesh = true;

    const paint = new PBRMaterial('sun-paint', scene);
    paint.unlit = true;
    paint.albedoColor = new Color3(1, 1, 1);
    paint.backFaceCulling = false;
    disc.material = paint;

    this.disc = disc;
    this.paint = paint;

    const rays = new VolumetricLightScatteringPostProcess(
      'rays', { postProcessRatio: 1.0, passRatio: 0.25 }, this.stage.camera,
      disc, 50, Texture.BILINEAR_SAMPLINGMODE, this.stage.engine, false, scene,
    );
    rays.exposure = 0.22;
    rays.decay = 0.965;
    rays.weight = 0.5;
    rays.density = 0.94;
    rays.getPass().renderList = [disc, ...this.solid];
    this.rays = rays;

    this.aim();
    this.aiming = (): void => this.aim();
    scene.onBeforeRenderObservable.add(this.aiming);
  }

  raysOn(): boolean {
    return !!this.rays;
  }

  private readonly toward = new Vector3(0, 1, 0);

  private aim(): void {
    const disc = this.disc;
    if (!disc) {
      return;
    }
    const sun = this.stage.sun;
    sun.direction.negateToRef(this.toward).normalize();
    const camera = this.stage.camera;
    disc.position.set(
      camera.position.x + this.toward.x * SUN_REACH,
      camera.position.y + this.toward.y * SUN_REACH,
      camera.position.z + this.toward.z * SUN_REACH,
    );
    const lit = Math.max(0, Math.min(1, sun.intensity));
    this.paint!.albedoColor = sun.diffuse.scale(0.35 + 0.65 * lit);
  }

  private stop(): void {
    if (this.aiming) {
      this.stage.scene.onBeforeRenderObservable.removeCallback(this.aiming);
      this.aiming = null;
    }
    if (this.rays) {
      const camera = this.stage.camera;
      const at = camera.customRenderTargets.indexOf(this.rays.getPass());
      if (at >= 0) {
        camera.customRenderTargets.splice(at, 1);
      }
      this.rays.dispose(camera);
      this.rays = null;
    }
    this.paint?.dispose();
    this.paint = null;
    this.disc?.dispose();
    this.disc = null;
  }

  setGrassShadows(on: boolean): void {
    this.shading = on;
    for (const mesh of this.grass) {
      mesh.receiveShadows = on;
    }
    this.stage.shadows.normalBias = on ? 0.4 : 0;
    this.stage.shadows.bias = on ? 0.008 : 0.00005;
    this.casters();
  }

  setGrassFromSelf(on: boolean): void {
    this.fromSelf = on;
    this.casters();
  }

  private casters(): void {
    const lit = !this.shading || this.fromSelf;
    for (const chunk of this.sheet) {
      if (lit) {
        this.stage.shadows.addShadowCaster(chunk);
      } else {
        this.stage.shadows.removeShadowCaster(chunk);
      }
    }
  }

  dispose(): void {
    this.ao?.dispose();
    this.ao = null;
    this.stage.scene.disableGeometryBufferRenderer();
    this.stop();
  }
}
