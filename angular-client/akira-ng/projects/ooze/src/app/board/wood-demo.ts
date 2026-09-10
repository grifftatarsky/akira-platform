import { ChangeDetectionStrategy, Component } from '@angular/core';
import { WOOD_THEME } from './board-assets';
import { WOOD_NAME, at, woodMap } from './wood-level';
import { Encounter } from './board.models';
import { PlaceDemo, figure } from './place-demo';

/**
 * A cabin in a clearing, and a wood around it.
 *
 * <p>The trees are the meadow's own machinery at forty times the scale — same
 * instancing, same chunks, same pixel budget, same wind, same light through the
 * leaves — which is the claim this board exists to test.
 */
@Component({
  selector: 'ooze-wood-demo',
  standalone: true,
  imports: [PlaceDemo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full w-full min-h-0' },
  template: `<ooze-place-demo [encounter]="encounter" [theme]="theme"
                              blurb="four in the afternoon, September. Somebody
                                     cleared this, and the wood is taking it back." />`,
})
export class WoodDemo {

  protected readonly theme = WOOD_THEME;

  protected readonly encounter: Encounter = {
    id: 'wood',
    name: WOOD_NAME,
    map: { id: 'wood-map', ...woodMap() },
    combatants: [
      figure('c-woodsman', 'Woodsman', at(25, 15)),
      figure('c-dog', 'Dog', at(26, 17), 5),
      figure('c-walker', 'Traveller', at(9, 14)),
      figure('c-bear', 'Something Large', at(36, 22), 20),
    ],
  };
}
