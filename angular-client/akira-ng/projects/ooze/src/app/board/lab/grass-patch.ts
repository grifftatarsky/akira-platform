import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { cardGeometry, loadFoliage } from '../bab/foliage-cards';
import { type Meadow, type PlantShape, sowMeadow } from '../bab/meadow';
import type { Stage } from '../bab/stage';
import { type Terrain, buildTerrain } from '../bab/terrain';
import { FIELD_THEME, type SplatGround } from '../board-assets';
import { sceneForEncounter } from '../board-scene';
import { groundField } from '../ground-field';

const PATCH_CELLS = 12;
const CELL_FEET = 5;

export interface Sowing {
  readonly name: string;
  readonly meadow: Meadow;
  readonly triangles: number;
}

export interface GrassPatch {
  readonly sowings: readonly Sowing[];
  readonly terrain: Terrain;
  readonly slots: number;
  materials(): readonly PBRMaterial[];
  show(name: string): void;
  freeze(on: boolean): void;
  dispose(): void;
}

export async function grassPatch(
  stage: Stage, shapes: Readonly<Record<string, PlantShape>> = { cards: cardGeometry },
): Promise<GrassPatch> {
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
  terrain.grassProxy.forEach(chunk => stage.shadows.addShadowCaster(chunk));

  const sheet = await loadFoliage(stage.scene);
  const sowings = Object.entries(shapes).map(([name, shape]): Sowing => {
    const meadow = sowMeadow(field, stage.scene, sheet, undefined, shape, true);
    return {
      name,
      meadow,
      triangles: meadow.sown.reduce(
        (sum, sown) => sum + sown.mesh.getTotalIndices() / 3, 0,
      ),
    };
  });

  let frozen = false;
  let held = 0;
  const tick = stage.scene.onBeforeRenderObservable.add(() => {
    const seconds = frozen ? held : performance.now() / 1000;
    sowings.forEach(sowing => sowing.meadow.step(seconds));
  });

  let shown = sowings[0].name;
  const show = (name: string): void => {
    shown = name;
    sowings.forEach(sowing => sowing.meadow.sown.forEach(
      sown => sown.mesh.setEnabled(sowing.name === name),
    ));
  };
  show(shown);

  stage.frame(
    field.extentXHalfFeet / 2, field.extentYHalfFeet / 2, 0,
    Math.max(field.extentXHalfFeet, field.extentYHalfFeet),
  );

  return {
    sowings,
    terrain,
    slots: sowings[0].meadow.sown.reduce((sum, sown) => sum + sown.cap, 0),
    materials(): readonly PBRMaterial[] {
      return sowings
        .filter(sowing => sowing.name === shown)
        .flatMap(sowing => sowing.meadow.sown.map(sown => sown.mesh.material as PBRMaterial));
    },
    show,
    freeze(on: boolean): void {
      if (on && !frozen) {
        held = performance.now() / 1000;
      }
      frozen = on;
    },
    dispose(): void {
      stage.scene.onBeforeRenderObservable.remove(tick);
      sowings.forEach(sowing => sowing.meadow.dispose());
      sheet.texture.dispose();
      terrain.dispose();
    },
  };
}
