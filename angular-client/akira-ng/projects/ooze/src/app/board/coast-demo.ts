import { ChangeDetectionStrategy, Component } from '@angular/core';
import { COAST_THEME } from './board-assets';
import { COAST_NAME, at, coastMap } from './coast-level';
import { Encounter } from './board.models';
import { PlaceDemo, figure } from './place-demo';

/**
 * A ruined light above the sea.
 *
 * <p>Here to answer whether the ground machinery generalises past one meadow:
 * the cliff is elevation, the shore is wear, the sea is a terrain kind, the
 * scrub is a planting and the tower is built. Nothing about it is bespoke
 * except the numbers.
 */
@Component({
  selector: 'ooze-coast-demo',
  standalone: true,
  imports: [PlaceDemo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full w-full min-h-0' },
  template: `<ooze-place-demo [encounter]="encounter" [theme]="theme"
                              blurb="half past six, September. A hundred and ten feet
                                     of cliff, and one stair up it." />`,
})
export class CoastDemo {

  protected readonly theme = COAST_THEME;

  protected readonly encounter: Encounter = {
    id: 'coast',
    name: COAST_NAME,
    map: { id: 'coast-map', ...coastMap() },
    combatants: [
      figure('c-keeper', 'Keeper', at(41, 16)),
      figure('c-climber', 'Climber', at(24, 17)),
      figure('c-shore', 'Beachcomber', at(12, 21)),
      figure('c-watch', 'Watcher', at(43, 24)),
    ],
  };
}
