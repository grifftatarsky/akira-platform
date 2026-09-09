import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { of, switchMap } from 'rxjs';
import { Battle } from './board.models';
import { BattleBoard } from './battle-board';
import { BoardService } from './board.service';

/**
 * The board, for one encounter and optionally a battle running on it.
 *
 * <p>Route-level and lazy, so three is only loaded when somebody opens a board.
 * The compendium has no use for a renderer and should not pay ~130 KB gzipped
 * for one.
 *
 * <p><b>Route parameters are read from {@link ActivatedRoute}, not bound as
 * component inputs.</b> Ooze is a federation remote: its routes are loaded into
 * whichever router the host provides, and component input binding only works if
 * that host called {@code withComponentInputBinding()}. This one does not, and a
 * remote is in no position to require it — a required input that silently never
 * arrives fails at runtime in the shell and works perfectly standalone, which is
 * the worst way to find out.
 */
@Component({
  selector: 'ooze-board-page',
  standalone: true,
  imports: [BattleBoard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="h-[calc(100vh-8rem)] w-full p-2">
      @if (encounter(); as e) {
        <ooze-battle-board
          [encounter]="e"
          [battle]="live()"
          (moved)="onMoved($event)"
          (selected)="selectedId.set($event)" />
      } @else {
        <p class="grid h-full place-items-center text-sm text-fg-subtle">Loading the board…</p>
      }
    </div>
  `,
})
export class BoardPage {

  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(BoardService);

  protected readonly encounter = toSignal(
    this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('encounterId');
        return id ? this.api.encounter(id) : of(undefined);
      })));

  /** Optional: a board with no fight on it is a perfectly good thing to look at. */
  protected readonly battle = toSignal(
    this.route.queryParamMap.pipe(
      switchMap(params => {
        const id = params.get('battleId');
        return id ? this.api.battle(id) : of(undefined);
      })));

  /**
   * The battle as the server last described it.
   *
   * <p>Held separately from the loaded one so a move can replace it without
   * re-fetching: every mutating route returns the whole battle, which is what
   * makes the board self-correcting — if the server refused a move, or stopped
   * it partway for an Opportunity Attack, the next frame draws what actually
   * happened rather than what the drag hoped for.
   */
  private readonly fromServer = signal<Battle | null>(null);

  protected readonly selectedId = signal<string | null>(null);

  protected live(): Battle | null {
    return this.fromServer() ?? this.battle() ?? null;
  }

  /**
   * Posts a dragged creature's route.
   *
   * <p>Only during a fight. Dragging on a saved board moves the *placement*,
   * which is a different call and a different meaning — one is where a creature
   * starts and the other is where it has got to, and conflating them is how a
   * fight would silently rewrite the encounter it came from.
   */
  protected onMoved(event: {
    id: string;
    path: { xHalfFeet: number; yHalfFeet: number; zHalfFeet: number }[];
  }): void {
    const battle = this.live();
    if (battle) {
      this.api.move(battle.id, event.id, event.path)
        .subscribe(updated => this.fromServer.set(updated));
      return;
    }
    const encounter = this.encounter();
    const combatant = encounter?.combatants.find(c => c.id === event.id);
    const to = event.path.at(-1);
    if (encounter && combatant && to) {
      this.api.placeCombatant(encounter.id, combatant, to).subscribe();
    }
  }
}
