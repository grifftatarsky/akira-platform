import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect,
  input, viewChild,
} from '@angular/core';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { type Plant, plantGeometry } from './species';

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
  private gone = false;

  constructor() {
    // Rebuilds the model when the chosen plant changes. The scene, engine and
    // camera survive; only the geometry and its colours are replaced.
    effect(() => {
      const plant = this.plant();
      if (this.scene) {
        this.model(plant);
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
    sky.intensity = 0.7;
    sky.diffuse = new Color3(0.6, 0.72, 0.9);
    sky.groundColor = new Color3(0.2, 0.18, 0.14);

    this.model(this.plant());
    // Turning slowly, because a silhouette is the thing being judged and a
    // still one only shows you a single angle of it.
    scene.onBeforeRenderObservable.add(() => {
      camera.alpha += 0.0045;
    });
    engine.runRenderLoop(() => scene.render());
  }

  private model(plant: Plant): void {
    const scene = this.scene;
    if (!scene) {
      return;
    }
    this.mesh?.dispose();
    const mesh = new Mesh('plant', scene);
    plantGeometry(plant).applyToMesh(mesh);
    // The board scales the plant by its instance matrix; here that scale is
    // applied directly, and then normalised so a daisy and a clover are both
    // worth looking at rather than one filling the frame.
    mesh.scaling = new Vector3(plant.wide, 1, plant.wide);

    const material = new PBRMaterial('plant', scene);
    material.albedoColor = new Color3(plant.base[0], plant.base[1], plant.base[2]);
    material.metallic = 0;
    material.roughness = 0.75;
    material.backFaceCulling = false;
    material.twoSidedLighting = false;
    material.albedoTexture = RawTexture.CreateRGBATexture(
      new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false,
      Texture.NEAREST_SAMPLINGMODE,
    );
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
