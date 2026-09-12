import { bladeGeometry, twistedCards } from '../bab/blade-geometry';
import { cardGeometry } from '../bab/foliage-cards';
import type { Experiment, Rig } from './experiments';
import { swardPatch } from './sward-patch';

export const blade: Experiment = async (stage): Promise<Rig> => {
  const patch = await swardPatch(stage, {
    card: cardGeometry,
    'card + twist': twistedCards,
    blade: bladeGeometry,
  });
  const names = patch.sowings.map(sowing => sowing.name);
  return {
    options: names,
    note: patch.sowings
      .map(sowing => `${sowing.name} ${Math.round(sowing.triangles).toLocaleString()} tris`)
      .join(' · ') + ` · ${patch.slots.toLocaleString()} slots`,
    pick(at: number): void {
      patch.show(names[Math.max(0, Math.min(names.length - 1, at))]);
    },
    freeze: patch.freeze,
    dispose: patch.dispose,
  };
};
