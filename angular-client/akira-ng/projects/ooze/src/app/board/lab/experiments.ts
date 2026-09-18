import type { Stage } from '../bab/stage';

export interface Rig {
  readonly options: readonly string[];
  pick(at: number): void;
  freeze(on: boolean): void;
  readonly note: string;
  dispose(): void;
}

export type Experiment = (stage: Stage) => Promise<Rig>;

const BENCH: Record<string, () => Promise<Experiment>> = {
  translucency: () => import('./translucency').then(module => module.translucency),
};

export async function experimentFor(id: string): Promise<Experiment | null> {
  const load = BENCH[id];
  return load ? await load() : null;
}
