import type { Scene } from '@babylonjs/core/scene';

// The inspector brings React, Fluent UI and five node editors with it: about
// 1 400 chunks, ten CommonJS warnings and most of ooze's production build time,
// for a panel only a developer opens. Production swaps this file for
// inspector.prod.ts (fileReplacements in angular.json), so it ships only in
// development builds and `ng serve`. A lazy import alone does not help — esbuild
// still has to bundle everything behind it.
export const inspectorAvailable = true;

export async function toggleInspector(scene: Scene): Promise<void> {
  await import('@babylonjs/inspector');
  if (scene.debugLayer.isVisible()) {
    scene.debugLayer.hide();
  } else {
    await scene.debugLayer.show({ embedMode: true, overlay: true });
  }
}
