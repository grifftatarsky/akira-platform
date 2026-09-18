import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { BattleBoard } from './battle-board';
import { KAYKIT_THEME, THEMES } from './board-assets';
import { Battle, Encounter, Participant } from './board.models';
import { CAST, SAMPLE_NAME, sampleMap, toCombatant, toParticipant } from './sample-level';

/**
 * A board with nothing behind it.
 *
 * <p>Exists so the renderer can be looked at without a database, a Keycloak or
 * a signed-in DM. Everything else on this route needs all three, and "run four
 * services to see whether the walls line up" is a bad enough loop that the walls
 * stay unchecked.
 *
 * <p><b>Six rooms rather than one, and furnished.</b> A bare rectangle proves
 * the renderer draws; it does not show whether a doorway lines up with the wall
 * it is cut into, whether a staircase actually reaches the ledge it serves,
 * whether a dark room stays dark once art loads over it, or whether a hundred
 * models on screen still run. Every one of those is a real failure this fixture
 * has caught, so the fixture is deliberately a whole dungeon level:
 *
 * <ul>
 *   <li>a torchlit barracks and hall, a dim storeroom, an unlit crypt and a
 *       flooded undercroft — three light levels, drawn over the art;
 *   <li>six terrains: floor, rubble, water, deep water, mud, web and a chasm;
 *   <li>a sanctum that steps up twice, with a staircase onto each level;
 *   <li>creatures from Tiny to Gargantuan, one of them flying over the fissure;
 *   <li>and about a hundred props, which is where the frame budget goes.
 * </ul>
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
        <span class="text-fg-subtle">— {{ encounter.name }}, no server, no sign-in</span>
        <span class="ml-auto flex items-center gap-1">
          @for (t of themes; track t.id) {
            <button type="button" (click)="theme.set(t)"
                    [attr.aria-pressed]="theme().id === t.id"
                    [class.text-fg]="theme().id === t.id"
                    [class.border-accent]="theme().id === t.id"
                    class="rounded-md border border-rule px-2 py-1 transition hover:text-fg">
              {{ t.name }}
            </button>
          }
        </span>
      </div>

      <div class="min-h-0 flex-1">
        <ooze-battle-board
          [encounter]="encounter"
          [battle]="battle()"
          [theme]="theme()"
          (moved)="onMoved($event)"
          (selected)="selected.set($event)" />
      </div>

      @if (theme().attribution; as credit) {
        <p class="text-[0.65rem] text-fg-subtle">{{ credit }}</p>
      } @else {
        <p class="text-[0.65rem] text-fg-subtle">
          No art loaded — the board falls back to colored tiles and the furniture
          goes with it, which is what removing a pack looks like. The rooms, the
          light and the terrain are all still there, because those are rules.
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
    name: SAMPLE_NAME,
    // The same description the encounters page posts to the server, so the
    // preview is a mock of a real response rather than a thing built beside
    // one. A fixture the server would reject is a fixture that was lying.
    map: { id: 'demo-map', ...sampleMap() },
    combatants: CAST.map(toCombatant),
  };

  protected readonly selected = signal<string | null>(null);

  /**
   * A fight in progress, so the ring, the bloodied color and on-deck all show.
   *
   * <p>Held in a signal so a drag can move somebody. There is no server behind
   * this route, and a preview where dragging does nothing is worse than no
   * preview — it reads as a broken renderer rather than as a page with no
   * backend. The engine's rules are absent here by design; what is being shown
   * is that the board picks, drags and redraws.
   */
  protected readonly battle = signal<Battle>({
    id: 'demo-battle',
    name: 'Round two',
    encounterId: 'demo',
    phase: 'IN_TURN',
    round: 2,
    currentParticipantId: 'p-owlbear',
    order: CAST.filter(c => !c.onDeck).map(toParticipant),
    onDeck: CAST.filter(c => c.onDeck).map(toParticipant),
  });

  /**
   * Moves a creature to where it was dropped.
   *
   * <p>The last leg of the path, because the path is what the engine walks and
   * there is no engine here — the preview shows the board, not the rules. On the
   * real route the whole path is posted and the server decides what actually
   * happened, which may be less than the drag asked for.
   */
  protected onMoved(event: {
    id: string;
    path: { xHalfFeet: number; yHalfFeet: number; zHalfFeet: number }[];
  }): void {
    const to = event.path.at(-1);
    if (!to) {
      return;
    }
    const move = (p: Participant): Participant =>
      p.id === event.id ? { ...p, xHalfFeet: to.xHalfFeet, yHalfFeet: to.yHalfFeet } : p;
    const current = this.battle();
    this.battle.set({
      ...current,
      order: current.order.map(move),
      onDeck: current.onDeck.map(move),
    });
  }
}
