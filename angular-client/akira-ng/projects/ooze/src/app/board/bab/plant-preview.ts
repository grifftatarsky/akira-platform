import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect,
  input, viewChild,
} from '@angular/core';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { cardGeometry, type FoliageSheet, loadFoliage } from './foliage-cards';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import type { Plant } from './species';

/**
 * One plant, on a turntable, big enough to argue with.
 *
 * <p>A blade of grass on the board is a few pixels tall and its shape can only
 * be judged in aggregate — which is fine for whether the field reads, and
 * useless for whether a clover looks like a clover. This is the same geometry
 * the meadow instances, drawn once at a size where the silhouette is the whole
 * picture.
 *
 * <p>Its own engine, because a Babylon engine belongs to a canvas. That is a
 * second WebGPU device for a panel that is closed by default, so it is only
 * built when the panel opens.
 */
@Component({
  selector: 'ooze-plant-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `<canvas #canvas class="h-56 w-full rounded bg-bg-sunk outline-none"
    style="touch-action: none"></canvas>`,
})
export class PlantPreview implements AfterViewInit, OnDestroy {

  readonly plant = input.required<Plant>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private engine: WebGPUEngine | null = null;
  private scene: Scene | null = null;
  private mesh: Mesh | null = null;
  private sheet: FoliageSheet | null = null;
  private gone = false;

  constructor() {
    // Rebuilds the model when the chosen plant changes. The scene, engine and
    // camera survive; only the geometry and its colours are replaced.
    effect(() => {
      const plant = this.plant();
      if (this.scene && this.sheet) {
        this.model(plant, this.sheet);
      }
    });
  }

  ngAfterViewInit(): void {
    void this.open();
  }

  private async open(): Promise<void> {
    const engine = new WebGPUEngine(this.canvas().nativeElement, {
      antialias: true, adaptToDeviceRatio: true,
    });
    await engine.initAsync();
    if (this.gone) {
      engine.dispose();
      return;
    }
    this.engine = engine;

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.07, 0.08, 0.07, 1);
    this.scene = scene;

    const camera = new ArcRotateCamera('view', -1.1, 1.15, 2.6, new Vector3(0, 0.45, 0), scene);
    camera.attachControl(this.canvas().nativeElement, false);
    camera.lowerRadiusLimit = 1.2;
    camera.upperRadiusLimit = 6;
    camera.wheelDeltaPercentage = 0.04;

    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.6), scene);
    sun.intensity = 2.4;
    const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
    // Brighter and warmer underneath than it was. The leaf texture is flagged
    // linear now rather than gamma — it always held reflectances and was being
    // put through sRGB-to-linear anyway — so the same rig that looked right
    // against the old, silently-darkened albedo now under-lights the true one.
    // The ground colour matters as much as the intensity: this is a critique
    // tool, and a leaf that turns its back on the key light should show its
    // shape, not a hole.
    sky.intensity = 1.15;
    sky.diffuse = new Color3(0.7, 0.78, 0.92);
    sky.groundColor = new Color3(0.34, 0.31, 0.26);

    const sheet = await loadFoliage(scene);
    if (this.gone) {
      engine.dispose();
      return;
    }
    this.sheet = sheet;
    this.model(this.plant(), sheet);
    // Turning slowly, because a silhouette is the thing being judged and a
    // still one only shows you a single angle of it.
    scene.onBeforeRenderObservable.add(() => {
      camera.alpha += 0.0045;
    });
    engine.runRenderLoop(() => scene.render());
  }

  private model(plant: Plant, sheet: FoliageSheet): void {
    const scene = this.scene;
    if (!scene) {
      return;
    }
    this.mesh?.dispose();
    const mesh = new Mesh('plant', scene);
    cardGeometry(plant, sheet).applyToMesh(mesh);
    // The geometry already carries the plant's proportions, so this only
    // normalises for the frame — a daisy and a clover are both worth looking
    // at rather than one filling it.
    const fit = 1 / Math.max(0.4, plant.tall);
    mesh.scaling = new Vector3(fit, fit, fit);

    const material = new PBRMaterial('plant', scene);
    material.albedoColor = new Color3(1, 1, 1);
    material.albedoTexture = sheet.texture;
    material.useAlphaFromAlbedoTexture = true;
    material.transparencyMode = PBRMaterial.MATERIAL_ALPHATEST;
    material.alphaCutOff = 0.28;
    material.metallic = 0;
    // The same value the meadow uses, because this is what the meadow will
    // look like and a preview that flatters is worse than no preview.
    material.roughness = 0.55;
    material.backFaceCulling = false;
    material.twoSidedLighting = false;

    material.subSurface.isTranslucencyEnabled = true;
    material.subSurface.translucencyIntensity = 0.9;
    material.subSurface.minimumThickness = 0.1;
    material.subSurface.maximumThickness = 0.6;
    material.subSurface.tintColor = new Color3(plant.tip[0], plant.tip[1], plant.tip[2]);
    mesh.material = material;
    this.mesh = mesh;
  }

  ngOnDestroy(): void {
    this.gone = true;
    this.mesh?.dispose();
    this.scene?.dispose();
    this.engine?.dispose();
  }
}
