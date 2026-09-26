import type { Scene } from '@babylonjs/core/scene';

// Stands in for inspector.ts in production builds; see there for why.
export const inspectorAvailable = false;

export async function toggleInspector(_scene: Scene): Promise<void> {}
