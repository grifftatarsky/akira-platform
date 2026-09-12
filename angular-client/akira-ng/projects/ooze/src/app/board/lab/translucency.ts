import type { Experiment, Rig } from './experiments';
import { swardPatch } from './sward-patch';

export const translucency: Experiment = async (stage): Promise<Rig> => {
  const patch = await swardPatch(stage);
  const asBuilt = patch.materials.map(material => material.subSurface.translucencyIntensity);
  return {
    note: `${patch.slots.toLocaleString()} slots, `
      + `${patch.materials.length} materials, intensity `
      + asBuilt.map(value => value.toFixed(2)).join(' / '),
    set(on: boolean): void {
      patch.materials.forEach((material, at) => {
        material.subSurface.isTranslucencyEnabled = on;
        material.subSurface.translucencyIntensity = on ? asBuilt[at] : 0;
      });
    },
    freeze: patch.freeze,
    dispose: patch.dispose,
  };
};
