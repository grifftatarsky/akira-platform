import type { Experiment, Rig } from './experiments';
import { grassPatch } from './grass-patch';

export const translucency: Experiment = async (stage): Promise<Rig> => {
  const patch = await grassPatch(stage);
  const asBuilt = patch.materials().map(material => material.subSurface.translucencyIntensity);
  return {
    options: ['off', 'on'],
    note: `${patch.slots.toLocaleString()} slots, `
      + `${patch.materials().length} materials, intensity `
      + asBuilt.map(value => value.toFixed(2)).join(' / '),
    pick(at: number): void {
      const on = at > 0;
      patch.materials().forEach((material, index) => {
        material.subSurface.isTranslucencyEnabled = on;
        material.subSurface.translucencyIntensity = on ? asBuilt[index] : 0;
      });
    },
    freeze: patch.freeze,
    dispose: patch.dispose,
  };
};
