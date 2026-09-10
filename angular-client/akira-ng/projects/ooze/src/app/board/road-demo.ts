import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { BattleBoard } from './battle-board';
import { FIELD_THEME } from './board-assets';
import { Combatant, Encounter } from './board.models';
import { ROAD_NAME, at, roadMap } from './road-level';

/**
 * Open country, drawn from measured materials.
 *
 * <p>The counter-argument to the dungeon. That board is a stylised pack: flat
 * color off one hand-painted atlas, and no amount of lighting will make its
 * stone look like stone because there is no surface in it to light. This one is
 * scans — color, relief and roughness measured off real ground — and the whole
 * question it exists to answer is whether that is the difference it looks like
 * it should be.
 *
 * <p>Both boards remain. They are two different bets about how this should
 * look, and neither is settled.
 */
@Component({
  selector: 'ooze-road-demo',
  standalone: true,
  imports: [BattleBoard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-[calc(100vh-8rem)] w-full flex-col gap-2 p-2">
      <div class="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span class="font-semibold text-fg">{{ name }}</span>
        <span class="text-fg-subtle">
          — one in the afternoon, July. No server, no sign-in.
        </span>
      </div>

      <div class="min-h-0 flex-1">
        <ooze-battle-board [encounter]="encounter" [theme]="theme" />
      </div>

      <p class="text-[0.65rem] text-fg-subtle">{{ theme.attribution }}</p>
    </div>
  `,
})
export class RoadDemo {

  protected readonly name = ROAD_NAME;
  protected readonly theme = FIELD_THEME;

  protected readonly encounter: Encounter = {
    id: 'road',
    name: ROAD_NAME,
    map: { id: 'road-map', ...roadMap() },
    combatants: [
      // A few travellers, for scale. Without something the size of a person on
      // it, a road is just a texture and there is no telling how wide it is.
      traveller('c-carter', 'Carter', 21, 15),
      traveller('c-mare', 'Draught Mare', 22, 16, 20),
      traveller('c-boy', 'Drover', 30, 13),
      traveller('c-walker', 'Traveller', 9, 17),
    ],
  };

  protected readonly selected = signal<string | null>(null);
}

function traveller(
  id: string, name: string, cellX: number, cellY: number, space = 10,
): Combatant {
  const { x, y } = at(cellX, cellY);
  return {
    id,
    statBlockId: `sb-${id}`,
    gameCharacterId: null,
    name,
    xHalfFeet: x,
    yHalfFeet: y,
    zHalfFeet: 0,
    disposition: 'ACTIVE',
    surprised: false,
    size: null,
    spaceHalfFeet: space,
    capabilities: [],
  };
}
