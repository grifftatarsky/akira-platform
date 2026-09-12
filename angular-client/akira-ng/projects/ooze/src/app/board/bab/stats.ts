import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Scene } from '@babylonjs/core/scene';
import { type GpuPass, type TimedPass, framePasses } from './gpu-passes';

export interface FrameCost {
  readonly fps: number;
  readonly wallMs: number;
  readonly frameMs: number;
  readonly cullMs: number;
  readonly drawCalls: number;
  readonly activeMeshes: number;
  readonly triangles: number;
  readonly shaderMs: number;
  readonly passes: readonly GpuPass[];
}

export class Stats {

  private readonly scene: SceneInstrumentation;
  private readonly engine: EngineInstrumentation;

  constructor(
    private readonly target: Scene,
    private readonly compute: readonly TimedPass[] = [],
  ) {
    this.scene = new SceneInstrumentation(target);
    this.scene.captureFrameTime = true;
    this.scene.captureActiveMeshesEvaluationTime = true;
    this.scene.captureRenderTargetsRenderTime = true;

    this.engine = new EngineInstrumentation(target.getEngine());
    this.engine.captureShaderCompilationTime = true;
  }

  read(): FrameCost {
    const engine = this.target.getEngine();
    const fps = Math.round(engine.getFps());
    const passes = framePasses(this.target, this.compute);
    return {
      fps,
      wallMs: round(fps > 0 ? 1000 / fps : 0),
      frameMs: round(this.scene.frameTimeCounter.lastSecAverage),
      cullMs: round(this.scene.activeMeshesEvaluationTimeCounter.lastSecAverage),
      drawCalls: this.scene.drawCallsCounter.current,
      activeMeshes: this.target.getActiveMeshes().length,
      triangles: Math.round(this.target.getActiveIndices() / 3),
      shaderMs: round(this.engine.shaderCompilationTimeCounter.total),
      passes,
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
