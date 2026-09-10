import { Camera, HalfFloatType, Scene, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { gradePass } from './board-grade';

/**
 * The two passes that stop the board looking like a diagram of a dungeon.
 *
 * <p><b>Ambient occlusion is what plants things.</b> A barrel standing against a
 * wall, lit correctly, still reads as a barrel *pasted onto* a wall until the
 * crease between them darkens. Direct light cannot produce that — the light
 * reaching a crevice is the light that failed to reach it after bouncing, and
 * nothing in a forward renderer knows about bounces. GTAO estimates it from the
 * depth buffer, and it is the single change that makes a scene feel occupied
 * rather than arranged.
 *
 * <p><b>Bloom is what makes a flame a flame.</b> The light field lets a torch
 * pool exceed full brightness on purpose; without a bloom pass that headroom is
 * just a value the tone curve quietly compresses. With one, the excess spills
 * into the air around it, which is the whole visual signature of a lit dungeon.
 * The threshold is set so only that excess blooms — a white wall stays a wall.
 *
 * <p>Separate from the renderer because it is genuinely optional: a machine that
 * cannot afford it should draw the board without it rather than not draw the
 * board, and the difference has to be one flag and not a second code path.
 */
export class PostChain {

  private readonly composer: EffectComposer;
  private readonly ao: GTAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly render: RenderPass;
  private readonly grade: ShaderPass;

  /**
   * A stand-in camera for the occlusion pass, on the ground's layer alone.
   *
   * <p>GTAO renders the scene again, into depth and normal buffers, to find its
   * creases. That second submission is as expensive as the first, and on this
   * board most of it is grass — which the pass searches a two-foot radius for
   * occlusion and therefore cannot resolve at all. Given a camera that cannot
   * see the meadow, it draws the ground and the props and nothing else, and the
   * result is the same picture for half the geometry.
   *
   * <p>A clone rather than a flag, because the pass takes a camera and there is
   * no hook between "start the AO render" and "finish it". It is re-copied from
   * the real camera every frame and then put back on its own layer, since
   * `Object3D.copy` copies the layer mask along with everything else.
   */
  private aoCamera: Camera;
  private live: Camera;

  constructor(
    renderer: WebGLRenderer,
    private readonly scene: Scene,
    camera: Camera,
    width: number,
    height: number,
  ) {
    // Half-float, so a torch pool that is twice full brightness survives the
    // trip between passes. An 8-bit buffer would clip it to white before the
    // bloom pass ever saw it, and bloom would have nothing to find.
    const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);

    this.render = new RenderPass(scene, camera);
    this.composer.addPass(this.render);

    this.live = camera;
    this.aoCamera = camera.clone();
    this.aoCamera.layers.set(0);
    this.ao = new GTAOPass(scene, this.aoCamera, width, height);
    // The world unit is the half-foot, and every default in this pass is
    // written for a world measured in metres — a 0.25 radius here is an inch
    // and a half, which finds nothing. Four half-feet is two feet: the scale of
    // the crease where a crate meets a floor, which is what there is to find.
    this.ao.updateGtaoMaterial({
      radius: 4,
      distanceExponent: 1,
      thickness: 2,
      scale: 1,
      samples: 16,
      distanceFallOff: 1,
    });
    // Under one. Full-strength AO on a stylised pack reads as dirt in every
    // corner; this is meant to seat things, not to weather them.
    this.ao.blendIntensity = 0.75;
    this.composer.addPass(this.ao);

    // Threshold well above one, and it has to be. A lit room's floor is already
    // about 1.0 of linear radiance, so a threshold of 1.05 caught every
    // torchlit surface on the board and hazed the rooms it was supposed to be
    // picking lights out of. At 1.45 the only things over the line are the
    // flame sprites — which are additive and far past it — and the foot or two
    // of floor directly under one.
    this.bloom = new UnrealBloomPass(new Vector2(width, height), 0.35, 0.35, 1.45);
    this.composer.addPass(this.bloom);

    // Last, and the reason the renderer's own tone mapping does not fight it:
    // three skips in-material tone mapping when the target is not the canvas,
    // so the chain carries linear radiance the whole way and this applies the
    // curve once, at the end, where it can see the bloom too.
    this.composer.addPass(new OutputPass());

    // After the output pass, so it works on a picture rather than on an amount
    // of light. Tone mapping's job is to be faithful; this one's is to have an
    // opinion, and they are easier to tune apart than together.
    this.grade = gradePass();
    this.composer.addPass(this.grade);
  }

  /** Retunes the grade for a different kind of place. */
  setGrade(saturation: number, contrast: number, vignette: number): void {
    const uniforms = (this.grade.material as { uniforms: Record<string, { value: unknown }> })
      .uniforms;
    uniforms['saturation'].value = saturation;
    uniforms['contrast'].value = contrast;
    uniforms['vignette'].value = vignette;
  }

  /** Swaps the camera on every pass that holds one. */
  setCamera(camera: Camera): void {
    this.render.camera = camera;
    this.live = camera;
    this.aoCamera = camera.clone();
    this.aoCamera.layers.set(0);
    this.ao.camera = this.aoCamera;
  }

  /**
   * Resizes the whole chain.
   *
   * <p>Only the composer, and deliberately: it multiplies by the pixel ratio
   * and forwards the *device* size to every pass it owns. Calling `setSize` on
   * a pass afterwards undoes that with the CSS size — which is identical on a
   * 1x display and half the resolution on a 2x one, so the board rendered into
   * a quarter of its own canvas with the rest left black. It looked like a
   * layout bug and was not.
   */
  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  draw(): void {
    // The stand-in has to follow the real camera every frame — it is only
    // standing in for its layer mask, not for where it is looking.
    this.aoCamera.copy(this.live);
    this.aoCamera.layers.set(0);
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
    this.ao.dispose();
    this.bloom.dispose();
  }
}
