import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
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
}

export class Stats {

  private readonly scene: SceneInstrumentation;
  private readonly engine: EngineInstrumentation;

  constructor(private readonly target: Scene) {
    this.scene = new SceneInstrumentation(target);
    this.scene.captureFrameTime = true;
    this.scene.captureActiveMeshesEvaluationTime = true;
    this.scene.captureRenderTargetsRenderTime = true;

    this.engine = new EngineInstrumentation(target.getEngine());
    this.engine.captureGPUFrameTime = true;
    this.engine.captureShaderCompilationTime = true;
  }

  read(): FrameCost {
    const engine = this.target.getEngine();
    return {
      fps: Math.round(engine.getFps()),
      // Nanoseconds from the device, and the counter is zero until the first
      // second has passed rather than undefined.
      gpuMs: round(this.engine.gpuFrameTimeCounter.lastSecAverage / 1e6),
      frameMs: round(this.scene.frameTimeCounter.lastSecAverage),
      cullMs: round(this.scene.activeMeshesEvaluationTimeCounter.lastSecAverage),
      drawCalls: this.scene.drawCallsCounter.current,
      activeMeshes: this.target.getActiveMeshes().length,
      triangles: Math.round(this.target.getActiveIndices() / 3),
      shaderMs: round(this.engine.shaderCompilationTimeCounter.total),
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
