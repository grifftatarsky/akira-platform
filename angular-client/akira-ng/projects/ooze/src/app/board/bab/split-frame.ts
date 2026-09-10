import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';

/**
 * What each part of the frame costs, measured by taking it away.
 *
 * <p><b>Why by difference.</b> WebGPU times a *render pass*, and everything in
 * this scene that is not the shadow map lives in one: terrain, meadow and sky
 * are drawn into the same pass, so no counter can tell them apart. Turning one
 * off and watching the number move can. It is a blunt instrument — it also
 * removes whatever that group was occluding, so the parts do not have to sum to
 * the whole — but it answers the only question worth asking first, which is
 * *which one of these is the thirty milliseconds*.
 *
 * <p>Ten rounds of reading this renderer produced twenty confident claims about
 * where the time goes and no measurement of any of them. This is the
 * measurement. It is deliberately the first thing in the plan.
 *
 * <p>The counter is a per-frame duration in nanoseconds, published by the
 * device a frame or two after the frame it describes — timestamp resolution is
 * asynchronous — so every reading discards a warm-up and then takes a median
 * rather than a mean. A median because a stray long frame from a resize or a
 * shader compile is a different distribution, not a bigger sample of this one.
 */

export interface Slice {
  readonly name: string;
  /** Milliseconds the frame loses when this group is not drawn. */
  readonly ms: number;
  /** As a share of the whole frame. */
  readonly share: number;
}

export interface Group {
  readonly name: string;
  readonly meshes: readonly AbstractMesh[];
}

/** Frames thrown away after a change, then frames kept. */
const SETTLE = 12;
const SAMPLE = 24;

interface Counter { readonly counter: { readonly current: number } }

function gpuCounter(scene: Scene): Counter | undefined {
  return (scene.getEngine() as unknown as {
    gpuTimeInFrameForMainPass?: Counter;
  }).gpuTimeInFrameForMainPass;
}

/** Median of `SAMPLE` frames, in milliseconds, after `SETTLE` are discarded. */
async function measure(scene: Scene): Promise<number> {
  const counter = gpuCounter(scene);
  if (!counter) {
    return 0;
  }
  const taken: number[] = [];
  await new Promise<void>(done => {
    let seen = 0;
    const watcher = scene.onAfterRenderObservable.add(() => {
      seen++;
      if (seen > SETTLE) {
        taken.push(counter.counter.current / 1e6);
      }
      if (taken.length >= SAMPLE) {
        scene.onAfterRenderObservable.remove(watcher);
        done();
      }
    });
  });
  taken.sort((a, b) => a - b);
  return taken[taken.length >> 1] ?? 0;
}

/**
 * Measures the whole frame, then each group by its absence.
 *
 * <p>Takes about a second per group. Restores every mesh it hid, including on
 * the way out of a failure, because leaving the board with its terrain missing
 * would be a worse bug than the one this is looking for.
 */
export async function splitFrame(
  scene: Scene, groups: readonly Group[],
): Promise<Slice[]> {
  if (!gpuCounter(scene)) {
    return [];
  }
  const whole = await measure(scene);
  const slices: Slice[] = [
    { name: 'whole frame', ms: round(whole), share: 1 },
  ];
  for (const group of groups) {
    const was = group.meshes.map(mesh => mesh.isEnabled(false));
    try {
      group.meshes.forEach(mesh => mesh.setEnabled(false));
      const without = await measure(scene);
      const cost = Math.max(0, whole - without);
      slices.push({
        name: group.name,
        ms: round(cost),
        share: whole > 0 ? cost / whole : 0,
      });
    } finally {
      group.meshes.forEach((mesh, at) => mesh.setEnabled(was[at]));
    }
  }
  return slices;
}

function round(ms: number): number {
  return Number(ms.toFixed(2));
}
