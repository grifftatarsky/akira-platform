import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, of, switchMap } from 'rxjs';
import { Battle, Encounter } from './board.models';
import { BattleBoard } from './battle-board';
import { BoardService } from './board.service';
import { CatalogItem } from '../finder/ooze-content.models';
import { ContentService } from '../finder/content.service';

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
  imports: [BattleBoard, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-[calc(100vh-8rem)] w-full flex-col gap-2 p-2">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <a [routerLink]="['encounters']" [relativeTo]="root"
           class="rounded-md border border-rule px-2 py-1 text-fg-subtle transition
                  hover:border-accent hover:text-fg">← Encounters</a>
        <span class="font-semibold text-fg">{{ encounter()?.name ?? 'Loading…' }}</span>

        @if (live(); as fight) {
          <span class="rounded-md border border-rule px-2 py-1 text-fg-muted">
            Round {{ fight.round }}
          </span>
        } @else if (encounter()) {
          <button type="button" (click)="rollInitiative()" [disabled]="busy()"
                  class="rounded-md bg-accent px-2 py-1 font-medium text-accent-fg transition
                         hover:bg-accent-hover disabled:opacity-50">
            Roll initiative
          </button>
        }

        <span class="ml-auto flex items-center gap-1">
          <input [(ngModel)]="hunt" name="hunt" type="search"
                 [placeholder]="live() ? 'Not during a fight' : 'Add a creature…'"
                 [disabled]="!!live()"
                 [title]="live()
                   ? 'A creature added now would join the saved board, not the fight running on it'
                   : 'Search the bestiary'"
                 (input)="search()"
                 class="w-44 rounded-md border border-rule bg-bg px-2 py-1 text-fg
                        disabled:opacity-40" />
          @if (selectedId(); as id) {
            <button type="button" (click)="remove(id)" [disabled]="busy() || !!live()"
                    class="rounded-md border border-rule px-2 py-1 text-fg-subtle transition
                           hover:border-danger hover:text-danger disabled:opacity-40"
                    title="Take this creature off the board">Remove</button>
          }
        </span>
      </div>

      @if (matches().length > 0) {
        <div class="flex flex-wrap gap-1">
          @for (m of matches(); track m.id) {
            <button type="button" (click)="place(m)" [disabled]="busy()"
                    class="rounded-md border border-rule bg-bg-subtle px-2 py-1 text-xs text-fg
                           transition hover:border-accent disabled:opacity-50">
              {{ m.name }}
            </button>
          }
        </div>
      }

      @if (error(); as message) {
        <p class="rounded-md border border-danger/40 bg-danger-subtle px-2 py-1 text-xs
                  text-danger">{{ message }}</p>
      }

      <div class="min-h-0 flex-1">
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
    </div>
  `,
})
export class BoardPage {

  private readonly route = inject(ActivatedRoute);

  /** The remote's own root — see the note in the encounters list. */
  protected readonly root = inject(ActivatedRoute).parent;
  private readonly router = inject(Router);
  private readonly api = inject(BoardService);
  private readonly catalog = inject(ContentService);

  private readonly loaded = toSignal(
    this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('encounterId');
        return id ? this.api.encounter(id) : of(undefined);
      })));

  /**
   * The encounter as the server last described it.
   *
   * <p>Held apart from the loaded one so placing or removing a creature can
   * replace it without a re-fetch — every mutating route hands back the whole
   * encounter, which is what keeps the board honest about what the server
   * actually did rather than about what the click hoped for.
   */
  private readonly edited = signal<Encounter | null>(null);

  protected readonly encounter = computed(() => this.edited() ?? this.loaded() ?? null);

  /** Optional: a board with no fight on it is a perfectly good thing to look at. */
  protected readonly loadedBattle = toSignal(
    this.route.queryParamMap.pipe(
      switchMap(params => {
        const id = params.get('battleId');
        return id ? this.api.battle(id) : of(undefined);
      })));

  private readonly fromServer = signal<Battle | null>(null);

  protected readonly selectedId = signal<string | null>(null);
  protected readonly matches = signal<CatalogItem[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected hunt = '';

  protected live(): Battle | null {
    return this.fromServer() ?? this.loadedBattle() ?? null;
  }

  /**
   * Looks for a creature to drop on the board.
   *
   * <p>Against the bestiary the compendium already serves, rather than a
   * search of its own. One catalog, one set of overrides — a DM who edited the
   * Owlbear should get *their* Owlbear here without this screen knowing that
   * overrides exist.
   */
  protected search(): void {
    const query = this.hunt.trim();
    // Nothing to add to. A battle is a *copy* of the encounter, so a creature
    // placed on the board now would not be in the fight the board is drawing —
    // it would appear to do nothing, which is worse than not offering it.
    // Reinforcements mid-fight are the engine's on-deck flow and a different
    // call; this is not that, and should not pretend to be.
    if (this.live() || query.length < 2) {
      this.matches.set([]);
      return;
    }
    this.catalog.list('monster', { query, size: 8 })
      .subscribe(page => this.matches.set(page.content));
  }

  /**
   * Puts the picked creature on the board.
   *
   * <p>In the middle, because the alternative is asking where before there is
   * anything to point at. Dragging it is the next thing a DM does anyway, and
   * that already works.
   */
  protected place(monster: CatalogItem): void {
    const encounter = this.encounter();
    if (!encounter) {
      return;
    }
    const map = encounter.map;
    this.act(this.api.placeMonster(encounter.id, monster.id, {
      xHalfFeet: Math.round((map.width * map.cellFeet * 2) / 2),
      yHalfFeet: Math.round((map.height * map.cellFeet * 2) / 2),
    }));
    this.hunt = '';
    this.matches.set([]);
  }

  protected remove(combatantId: string): void {
    const encounter = this.encounter();
    if (encounter) {
      this.act(this.api.removeCombatant(encounter.id, combatantId));
      this.selectedId.set(null);
    }
  }

  /**
   * Lifts the encounter into a running fight.
   *
   * <p>The battle is a copy, not a link, so playing it leaves the saved board
   * untouched — which is why the fight lands on the same route with a query
   * parameter rather than replacing the encounter.
   */
  protected rollInitiative(): void {
    const encounter = this.encounter();
    if (!encounter) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.api.launchBattle(encounter.id, encounter.name).subscribe({
      next: battle => {
        this.busy.set(false);
        this.fromServer.set(battle);
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { battleId: battle.id },
          queryParamsHandling: 'merge',
        });
      },
      error: err => this.fail(err, 'Initiative could not be rolled.'),
    });
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
      this.api.move(battle.id, event.id, event.path).subscribe({
        next: updated => this.fromServer.set(updated),
        error: err => this.fail(err, 'That move was refused.'),
      });
      return;
    }
    const encounter = this.encounter();
    const combatant = encounter?.combatants.find(c => c.id === event.id);
    const to = event.path.at(-1);
    if (encounter && combatant && to) {
      // Through `act`, so the board is redrawn from what the server stored.
      // Without that the drag posted and nothing adopted the answer: the
      // renderer does not move a token itself — it reports the gesture and
      // waits to be told — so the creature sat exactly where it started and the
      // whole board looked broken while working perfectly.
      this.act(this.api.placeCombatant(encounter.id, combatant, to));
    }
  }

  /**
   * Runs an edit, then asks the server what the board is now.
   *
   * <p>The re-read is deliberate rather than lazy. Placing a creature answers
   * with the creature and removing one answers with nothing, so neither reply
   * describes the board — and the server resolves things the request did not
   * say: a stat block's size becomes a footprint, and a footprint decides who
   * may stand where. Asking is one round trip and cannot be wrong; assembling
   * the new board from the reply is free and can.
   */
  private act(call: Observable<unknown>): void {
    const encounter = this.encounter();
    if (!encounter) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    call.pipe(switchMap(() => this.api.encounter(encounter.id))).subscribe({
      next: updated => {
        this.busy.set(false);
        this.edited.set(updated);
      },
      error: err => this.fail(err, 'That change was refused.'),
    });
  }

  private fail(error: unknown, fallback: string): void {
    this.busy.set(false);
    const detail = (error as { error?: { detail?: string; message?: string } })?.error;
    this.error.set(detail?.detail ?? detail?.message ?? fallback);
  }
}
