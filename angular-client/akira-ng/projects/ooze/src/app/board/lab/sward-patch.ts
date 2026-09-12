import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { loadFoliage } from '../bab/foliage-cards';
import { type Meadow, sowMeadow } from '../bab/meadow';
import type { Stage } from '../bab/stage';
import { type Terrain, buildTerrain } from '../bab/terrain';
import { FIELD_THEME, type SplatGround } from '../board-assets';
import { sceneForEncounter } from '../board-scene';
import { groundField } from '../ground-field';

const PATCH_CELLS = 12;
const CELL_FEET = 5;

export interface SwardPatch {
  readonly meadow: Meadow;
  readonly terrain: Terrain;
  readonly materials: readonly PBRMaterial[];
  readonly slots: number;
  freeze(on: boolean): void;
  dispose(): void;
}

export async function swardPatch(stage: Stage): Promise<SwardPatch> {
  const scene = sceneForEncounter({
    id: 'lab',
    name: 'lab',
    map: {
      id: 'lab-map',
      width: PATCH_CELLS,
      height: PATCH_CELLS,
      cellFeet: CELL_FEET,
      defaultTerrain: 'GRASS',
      defaultLight: 'BRIGHT',
      cells: [],
      props: [],
    },
    combatants: [],
  });

  const field = groundField(scene);
  const terrain = buildTerrain(FIELD_THEME.ground as SplatGround, field, stage.scene);
  terrain.chunks.forEach(chunk => stage.shadows.addShadowCaster(chunk));
  terrain.swardProxy.forEach(chunk => stage.shadows.addShadowCaster(chunk));

  const sheet = await loadFoliage(stage.scene);
  const meadow = sowMeadow(field, stage.scene, sheet);

  let frozen = false;
  let held = 0;
  const tick = stage.scene.onBeforeRenderObservable.add(() => {
    meadow.step(frozen ? held : performance.now() / 1000);
  });

  stage.frame(
    field.extentXHalfFeet / 2, field.extentYHalfFeet / 2, 0,
    Math.max(field.extentXHalfFeet, field.extentYHalfFeet),
  );

  return {
    meadow,
    terrain,
    materials: meadow.sown.map(sown => sown.mesh.material as PBRMaterial),
    slots: meadow.sown.reduce((sum, sown) => sum + sown.cap, 0),
    freeze(on: boolean): void {
      if (on && !frozen) {
        held = performance.now() / 1000;
      }
      frozen = on;
    },
    dispose(): void {
      stage.scene.onBeforeRenderObservable.remove(tick);
      meadow.dispose();
      sheet.texture.dispose();
      terrain.dispose();
    },
  };
}
