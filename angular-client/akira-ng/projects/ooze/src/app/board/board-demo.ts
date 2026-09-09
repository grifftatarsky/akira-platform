import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { BattleBoard } from './battle-board';
import { KAYKIT_THEME, PLAIN_THEME, THEMES } from './board-assets';
import { Battle, Combatant, Encounter, MapCell } from './board.models';

/**
 * A board with nothing behind it.
 *
 * <p>Exists so the renderer can be looked at without a database, a Keycloak or
 * a signed-in DM. Everything else on this route needs all three, and "run four
 * services to see whether the walls line up" is a bad enough loop that the walls
 * stay unchecked.
 *
 * <p>The fixture is deliberately awkward rather than tidy: a raised ledge, an
 * unlit corner, creatures from Tiny to Gargantuan, one of them flying. Those are
 * the cases that look wrong first, so a board that draws this correctly is
 * probably drawing everything correctly.
 */
@Component({
  selector: 'ooze-board-demo',
  standalone: true,
  imports: [BattleBoard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-[calc(100vh-8rem)] w-full flex-col gap-2 p-2">
      <div class="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span class="font-semibold text-fg">Board preview</span>
        <span class="text-fg-subtle">— no server, no sign-in</span>
        <span class="ml-auto flex items-center gap-1">
          @for (t of themes; track t.id) {
            <button type="button" (click)="theme.set(t)"
                    [class.text-fg]="theme().id === t.id"
                    [class.border-accent]="theme().id === t.id"
                    class="rounded-md border border-rule px-2 py-1 transition hover:text-fg">
              {{ t.name }}
            </button>
          }
        </span>
      </div>

      <div class="min-h-0 flex-1">
        <ooze-battle-board [encounter]="encounter" [battle]="battle" [theme]="theme()" />
      </div>

      @if (theme().attribution; as credit) {
        <p class="text-[0.65rem] text-fg-subtle">{{ credit }}</p>
      } @else {
        <p class="text-[0.65rem] text-fg-subtle">
          No art loaded — the board falls back to coloured tiles, which is what
          removing a pack looks like.
        </p>
      }
    </div>
  `,
})
export class BoardDemo {

  protected readonly themes = THEMES;
  protected readonly theme = signal(KAYKIT_THEME);

  protected readonly encounter: Encounter = {
    id: 'demo',
    name: 'The flooded vault',
    map: {
      id: 'demo-map',
      width: 16,
      height: 12,
      cellFeet: 5,
      defaultTerrain: 'FLOOR',
      defaultLight: 'BRIGHT',
      cells: buildRoom(),
    },
    combatants: [
      creature('c-owlbear', 'Owlbear', 65, 55, 20),
      creature('c-goblin', 'Goblin Warrior', 45, 75, 10),
      creature('c-rat', 'Giant Rat', 35, 95, 5),
      // On the ledge at the far end, twenty feet up.
      creature('c-boss', 'Hill Giant', 135, 35, 30),
      // Flying: same axis as standing on the ledge, which is the point.
      creature('c-imp', 'Imp', 105, 95, 5, 30),
    ],
  };

  /** A fight in progress, so the ring, the bloodied colour and on-deck all show. */
  protected readonly battle: Battle = {
    id: 'demo-battle',
    name: 'Round two',
    encounterId: 'demo',
    phase: 'IN_TURN',
    round: 2,
    currentParticipantId: 'p-owlbear',
    order: [
      participant('p-owlbear', 'Owlbear', 'c-owlbear', 65, 55, 0, { current: 41, max: 59 }),
      participant('p-goblin', 'Goblin Warrior', 'c-goblin', 45, 75, 0, { current: 3, max: 12 }),
      participant('p-boss', 'Hill Giant', 'c-boss', 135, 35, 0, { current: 105, max: 105 }),
      participant('p-imp', 'Imp', 'c-imp', 105, 95, 30, { current: 0, max: 10 }),
    ],
    onDeck: [
      participant('p-rat', 'Giant Rat', 'c-rat', 35, 95, 0, { current: 7, max: 7 }, 'ON_DECK'),
    ],
  };
}

/** A twelve-by-sixteen room: walled, part-ruined, with a raised end and a dark corner. */
function buildRoom(): MapCell[] {
  const cells: MapCell[] = [];
  const at = (x: number, y: number, over: Partial<MapCell> = {}): MapCell => ({
    x, y, elevationFeet: null, terrain: null, light: null, cover: null, opaque: null,
    extraMoveCostFeet: null, notes: null, ...over,
  });

  for (let x = 0; x < 16; x++) {
    cells.push(at(x, 0, { terrain: 'WALL' }));
    cells.push(at(x, 11, { terrain: 'WALL' }));
  }
  for (let y = 1; y < 11; y++) {
    cells.push(at(0, y, { terrain: 'WALL' }));
    cells.push(at(15, y, { terrain: 'WALL' }));
  }

  // An interior wall with a gap, so line of sight has something to do.
  for (const y of [3, 4, 5, 7, 8]) {
    cells.push(at(8, y, { terrain: 'WALL' }));
  }

  // A raised end. Stepping off it is 20 feet, which is 2d6 and Prone.
  for (let x = 12; x < 15; x++) {
    for (let y = 5; y < 9; y++) {
      cells.push(at(x, y, { elevationFeet: 20 }));
    }
  }

  // Rubble is Difficult Terrain, water is too, and the far corner is unlit.
  for (const [x, y] of [[3, 3], [4, 3], [3, 4]] as const) {
    cells.push(at(x, y, { terrain: 'RUBBLE' }));
  }
  for (const [x, y] of [[5, 8], [6, 8], [5, 9], [6, 9], [6, 10]] as const) {
    cells.push(at(x, y, { terrain: 'WATER' }));
  }
  for (let x = 1; x < 4; x++) {
    for (let y = 8; y < 11; y++) {
      cells.push(at(x, y, { light: x < 3 && y > 8 ? 'DARKNESS' : 'DIM' }));
    }
  }
  return cells;
}

function creature(
  id: string, name: string, x: number, y: number, space: number, z = 0,
): Combatant {
  return {
    id, statBlockId: `sb-${id}`, gameCharacterId: null, name,
    xHalfFeet: x, yHalfFeet: y, zHalfFeet: z,
    disposition: id === 'c-rat' ? 'ON_DECK' : 'ACTIVE',
    surprised: false, size: null, spaceHalfFeet: space, capabilities: [],
  };
}

function participant(
  id: string, name: string, combatantId: string, x: number, y: number, z: number,
  hp: { current: number; max: number }, disposition: 'ACTIVE' | 'ON_DECK' = 'ACTIVE',
) {
  return {
    id, name, initiative: 12, currentHitPoints: hp.current, maxHitPoints: hp.max,
    down: hp.current <= 0, bloodied: hp.current > 0 && hp.current * 2 <= hp.max,
    conditions: [], disposition, xHalfFeet: x, yHalfFeet: y, zHalfFeet: z,
    speedFeet: 30, movementRemainingFeet: 30, combatantId,
  };
}
