import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PASS_THEME } from './board-assets';
import { PASS_NAME, floorMiddle, passMap } from './pass-level';
import { Encounter } from './board.models';
import { PlaceDemo, figure } from './place-demo';

/**
 * A pass in winter: two walls of rock and one floor of snow.
 *
 * <p>The hardest of the three to make read, because snow is nearly white and
 * nearly featureless and everything that saves it is the shading of its own
 * shape. If this one works, the ground mesh is doing its job.
 */
@Component({
  selector: 'ooze-pass-demo',
  standalone: true,
  imports: [PlaceDemo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full w-full min-h-0' },
  template: `<ooze-place-demo [encounter]="encounter" [theme]="theme"
                              blurb="midday, January. The floor is deep snow, which
                                     is Difficult Terrain, which is the whole fight." />`,
})
export class PassDemo {

  protected readonly theme = PASS_THEME;

  protected readonly encounter: Encounter = {
    id: 'pass',
    name: PASS_NAME,
    map: { id: 'pass-map', ...passMap() },
    combatants: [
      figure('c-guide', 'Guide', floorMiddle(8)),
      figure('c-mule', 'Pack Mule', floorMiddle(10), 20),
      figure('c-scout', 'Scout', floorMiddle(24)),
      figure('c-rear', 'Rearguard', floorMiddle(6)),
    ],
  };
}
