import type { Scene } from '@babylonjs/core/scene';

export interface GpuPass {
  readonly name: string;
  readonly ms: number;
}

interface PerfSource {
  readonly counter: { readonly lastSecAverage: number };
  readonly _gpuTimeInFrameId: number;
}

const STALE_AFTER = 60;

export interface TimedPass {
  readonly name: string;
}

interface Post {
  readonly name: string;
  readonly inputTexture?: unknown;
  readonly _shareOutputWithPostProcess?: { readonly inputTexture?: unknown } | null;
  readonly _forcedOutputTexture?: unknown;
}

type Named = readonly [name: string, target: unknown];

function counterMs(source: PerfSource | undefined, frameId: number): number {
  if (!source || frameId - source._gpuTimeInFrameId > STALE_AFTER) {
    return 0;
  }
  const nanos = source.counter.lastSecAverage;
  return Number.isFinite(nanos) ? Number((nanos / 1e6).toFixed(2)) : 0;
}

function perf(holder: unknown): PerfSource | undefined {
  return (holder as { gpuTimeInFrame?: PerfSource } | null | undefined)?.gpuTimeInFrame;
}

function boundTarget(post: Post): unknown {
  return post._shareOutputWithPostProcess?.inputTexture
    ?? post._forcedOutputTexture
    ?? post.inputTexture;
}

function chain(scene: Scene): Named[] {
  const camera = scene.activeCamera as unknown as {
    _postProcesses?: readonly (Post | null)[];
  } | null;
  const posts = (camera?._postProcesses ?? []).filter((post): post is Post => !!post);
  return posts.map((post, at) => [at === 0 ? 'scene' : posts[at - 1].name, boundTarget(post)]);
}

function offscreen(scene: Scene): Named[] {
  return [
    ...scene.lights.flatMap((light): Named[] => {
      const map = light.getShadowGenerator()?.getShadowMap();
      return map ? [[`shadow ${light.name}`, map.renderTarget]] : [];
    }),
    ...(scene.reflectionProbes ?? []).map(
      (probe): Named => [`probe ${probe.name}`, probe.cubeTexture.renderTarget],
    ),
    ...scene.customRenderTargets.map(
      (target): Named => [target.name, target.renderTarget],
    ),
  ];
}

export function framePasses(
  scene: Scene, compute: readonly TimedPass[] = [],
): readonly GpuPass[] {
  const engine = scene.getEngine() as unknown as {
    frameId: number;
    gpuTimeInFrameForMainPass?: PerfSource;
  };
  const byTarget = new Map<object, string[]>();
  for (const [name, target] of [...chain(scene), ...offscreen(scene)]) {
    if (!target || !perf(target)) {
      continue;
    }
    const named = byTarget.get(target as object);
    if (named) {
      named.push(name);
    } else {
      byTarget.set(target as object, [name]);
    }
  }

  const passes: GpuPass[] = [
    ...[...byTarget].map(([target, names]) => ({
      name: names.join(' + '),
      ms: counterMs(perf(target), engine.frameId),
    })),
    ...compute.map(shader => ({
      name: shader.name,
      ms: counterMs(perf(shader), engine.frameId),
    })),
    { name: 'present', ms: counterMs(engine.gpuTimeInFrameForMainPass, engine.frameId) },
  ];
  return passes.filter(pass => pass.ms > 0).sort((a, b) => b.ms - a.ms);
}
