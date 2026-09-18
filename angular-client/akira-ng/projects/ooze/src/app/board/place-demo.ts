import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BattleBoard } from './battle-board';
import { BoardTheme } from './board-assets';
import { Combatant, Encounter } from './board.models';

/**
 * One board, with nothing behind it.
 *
 * <p>Every demo map was the same forty lines of component with three words
 * changed, which is a fair sign the component was not the interesting part. A
 * map is its terrain, its theme and a handful of people standing on it for
 * scale; this holds the frame around those.
 */
@Component({
  selector: 'ooze-place-demo',
  standalone: true,
  imports: [BattleBoard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full w-full min-h-0' },
  template: `
    <div class="flex h-[calc(100vh-8rem)] w-full flex-col gap-2 p-2">
      <div class="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span class="font-semibold text-fg">{{ encounter().name }}</span>
        <span class="text-fg-subtle">— {{ blurb() }}</span>
      </div>

      <div class="min-h-0 flex-1">
        <ooze-battle-board [encounter]="encounter()" [theme]="theme()" />
      </div>

      <p class="text-[0.65rem] text-fg-subtle">{{ theme().attribution }}</p>
    </div>
  `,
})
export class PlaceDemo {
  readonly encounter = input.required<Encounter>();
  readonly theme = input.required<BoardTheme>();
  readonly blurb = input('No server, no sign-in.');
}

/**
 * Somebody standing on the map, for scale.
 *
 * <p>Not decoration. A cliff, a wood and a snowfield are all textures until
 * there is something person-sized on them — a hundred and ten feet of rock
 * means nothing next to a hundred and ten feet of nothing.
 */
export function figure(
  id: string,
  name: string,
  at: { x: number; y: number; z: number },
  space = 10,
): Combatant {
  return {
    id,
    statBlockId: `sb-${id}`,
    gameCharacterId: null,
    name,
    xHalfFeet: Math.round(at.x),
    yHalfFeet: Math.round(at.y),
    // Standing on the ground, not at its elevation: the board adds the ground
    // under a creature itself, and adding it here as well puts everybody twice
    // as high up the cliff as they should be.
    zHalfFeet: 0,
    disposition: 'ACTIVE',
    surprised: false,
    size: null,
    spaceHalfFeet: space,
    capabilities: [],
  };
}
