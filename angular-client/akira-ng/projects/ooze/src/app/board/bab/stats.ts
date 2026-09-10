import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import type { Scene } from '@babylonjs/core/scene';

/**
 * What the frame costs, asked of the engine rather than of a stopwatch.
 *
 * <p>This replaces a hand-rolled `EXT_disjoint_timer_query` harness — three
 * screens of query pools, a two-phase read across task boundaries because a
 * result is not available in the frame that issued it, and a hard-won rule
 * that stages must never be interleaved. All of it existed because three.js
 * has no answer to "what did that cost". Babylon does, in the box, and it is
 * better than mine: `SceneInstrumentation` and `EngineInstrumentation` keep
 * rolling averages per counter, so the numbers do not jump the way a single
 * sample does.
 *
 * <p><b>GPU time needs `timestamp-query`.</b> On WebGPU that is a device
 * feature, requested in {@link Stage}; where it is missing `gpuMs` reads zero
 * and the CPU-side numbers still work. That is the honest failure mode — a
 * zero here means "not measured", never "free".
 *
 * <p>And it does not come from `EngineInstrumentation.gpuFrameTimeCounter`,
 * which is the WebGL-era counter and reads a flat zero on the WebGPU path
 * however much of the extension you have enabled. The WebGPU engine keeps its
 * own: `gpuTimeInFrameForMainPass`, populated from the timestamps written
 * either side of the main render pass. On the road board that reads 11.6 ms
 * against a 2.1 ms CPU frame — which is the whole point of asking, because the
 * CPU number alone says there is eight times more headroom than there is.
 */

export interface FrameCost {
  /** Frames a second, engine-smoothed. */
  readonly fps: number;
  /** GPU milliseconds a frame. Zero when `timestamp-query` is unavailable. */
  readonly gpuMs: number;
  /** Wall-clock milliseconds inside `scene.render`. */
  readonly frameMs: number;
  /** Of that, the part spent choosing what to draw before drawing any of it. */
  readonly cullMs: number;
  readonly drawCalls: number;
  readonly activeMeshes: number;
  /** Triangles actually submitted, not triangles that exist. */
  readonly triangles: number;
  /** Cumulative milliseconds spent compiling shaders, which is a load cost. */
  readonly shaderMs: number;
  /**
   * GPU milliseconds in the shadow cascades, separately from the main pass.
   *
   * <p>The only split WebGPU gives away for free: a render target is its own
   * pass, and `WebGPURenderTargetWrapper` carries a counter for it. Everything
   * else on the board — terrain, meadow, sky — is drawn into one pass and has
   * to be separated by taking it away instead. See `split-frame.ts`.
   */
  readonly shadowMs: number;
}

export class Stats {

  private readonly scene: SceneInstrumentation;
  private readonly engine: EngineInstrumentation;

  /**
   * Render targets to time individually.
   *
   * <p>Each one is its own WebGPU render pass, so unlike everything in the main
   * pass it can be read straight off the device rather than inferred from a
   * difference.
   */
  private readonly targets: RenderTargetTexture[] = [];

  constructor(private readonly target: Scene) {
    this.scene = new SceneInstrumentation(target);
    this.scene.captureFrameTime = true;
    this.scene.captureActiveMeshesEvaluationTime = true;
    this.scene.captureRenderTargetsRenderTime = true;

    this.engine = new EngineInstrumentation(target.getEngine());
    this.engine.captureGPUFrameTime = true;
    this.engine.captureShaderCompilationTime = true;
  }

  /** Times this render target's own pass from now on. */
  watch(texture: RenderTargetTexture): void {
    this.targets.push(texture);
  }

  read(): FrameCost {
    const engine = this.target.getEngine();
    // Nanoseconds from the device, and zero until the first second has passed.
    const webgpu = (engine as unknown as {
      gpuTimeInFrameForMainPass?: { counter: { lastSecAverage: number } };
    }).gpuTimeInFrameForMainPass;
    return {
      fps: Math.round(engine.getFps()),
      gpuMs: round(
        (webgpu?.counter.lastSecAverage ?? this.engine.gpuFrameTimeCounter.lastSecAverage) / 1e6,
      ),
      frameMs: round(this.scene.frameTimeCounter.lastSecAverage),
      cullMs: round(this.scene.activeMeshesEvaluationTimeCounter.lastSecAverage),
      drawCalls: this.scene.drawCallsCounter.current,
      activeMeshes: this.target.getActiveMeshes().length,
      triangles: Math.round(this.target.getActiveIndices() / 3),
      shaderMs: round(this.engine.shaderCompilationTimeCounter.total),
      shadowMs: round(this.targets.reduce((sum, texture) => {
        // Present only on the WebGPU wrapper, and only once
        // `enableGPUTimingMeasurements` is on and the device offered
        // `timestamp-query`. Absent reads as zero, which means "not measured".
        const wrapper = texture.renderTarget as unknown as {
          gpuTimeInFrame?: { counter: { lastSecAverage: number } };
        } | null;
        return sum + (wrapper?.gpuTimeInFrame?.counter.lastSecAverage ?? 0);
      }, 0) / 1e6),
    };
  }

  dispose(): void {
    this.scene.dispose();
    this.engine.dispose();
  }
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}
