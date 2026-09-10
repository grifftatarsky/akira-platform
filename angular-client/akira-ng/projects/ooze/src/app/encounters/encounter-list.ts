import {
  ChangeDetectionStrategy, Component, computed, effect, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { BoardService, EncounterSummary } from '../board/board.service';
import { SAMPLE_NAME, sampleMap } from '../board/sample-level';
import { ShellAuthService } from '../shell/shell-auth.service';

/**
 * A DM's saved boards.
 *
 * <p>The way in. Everything else about the board already worked and none of it
 * was reachable: the renderer had a route that wanted an encounter id and no
 * screen that could produce one, so a DM's only way to a real board was to know
 * a UUID.
 *
 * <p><b>Reads are gated too, not only writes.</b> An encounter is a plan for a
 * session and the players are not supposed to see it — the server scopes every
 * route to the caller's own and answers 404 rather than 403 for anyone else's,
 * so the existence of an id does not leak. This screen matches that: without
 * the role there is nothing to show rather than a list you cannot touch.
 */
@Component({
  selector: 'ooze-encounter-list',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto w-full max-w-4xl px-4 py-8">
      <header class="mb-6">
        <h1 class="text-2xl font-semibold tracking-tight text-fg">Encounters</h1>
        <p class="mt-1 text-sm text-fg-muted">
          A board, its terrain and everything standing on it. Saved between sessions,
          and private to you.
        </p>
      </header>

      @if (!canEdit()) {
        <p class="rounded-lg border border-rule bg-bg-subtle p-4 text-sm text-fg-muted">
          Building encounters needs the Dungeon Master role. Sign in as a DM to
          make one — or look at
          <a routerLink="/board" class="text-accent underline">the sample board</a>,
          which needs nothing at all.
        </p>
      } @else {
        <div class="mb-6 flex flex-wrap items-end gap-2 rounded-lg border border-rule
                    bg-bg-subtle p-3">
          <label class="flex min-w-48 flex-1 flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Name</span>
            <input [(ngModel)]="draftName" name="name" type="text"
                   placeholder="Ambush at the ford"
                   (keydown.enter)="create(false)"
                   class="rounded-md border border-rule bg-bg px-2 py-1.5 text-sm text-fg" />
          </label>
          <button type="button" (click)="create(false)" [disabled]="busy()"
                  class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg
                         transition hover:bg-accent-hover disabled:opacity-50">
            Blank board
          </button>
          <button type="button" (click)="create(true)" [disabled]="busy()"
                  class="rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-fg
                         transition hover:border-accent disabled:opacity-50"
                  title="A furnished six-room level, painted and lit">
            From the sample dungeon
          </button>
        </div>

        @if (error(); as message) {
          <p class="mb-4 rounded-md border border-danger/40 bg-danger-subtle px-3 py-2
                    text-sm text-danger">{{ message }}</p>
        }

        @if (encounters(); as list) {
          @if (list.length === 0) {
            <p class="rounded-lg border border-dashed border-rule p-8 text-center text-sm
                      text-fg-subtle">
              Nothing saved yet. The sample dungeon is the quickest look at what a
              board can hold.
            </p>
          } @else {
            <ul class="divide-y divide-rule rounded-lg border border-rule">
              @for (e of list; track e.id) {
                <li class="flex items-center gap-3 px-4 py-3">
                  <a [routerLink]="['/board', e.id]" class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium text-fg">{{ e.name }}</span>
                    <span class="block text-xs text-fg-subtle">
                      {{ e.width }}×{{ e.height }} squares of {{ e.cellFeet }} ft ·
                      {{ e.combatantCount }}
                      {{ e.combatantCount === 1 ? 'creature' : 'creatures' }}
                    </span>
                  </a>
                  <a [routerLink]="['/board', e.id]"
                     class="rounded-md border border-rule px-2 py-1 text-xs text-fg-muted
                            transition hover:border-accent hover:text-fg">Open</a>
                  <button type="button" (click)="remove(e)" [disabled]="busy()"
                          class="rounded-md border border-rule px-2 py-1 text-xs text-fg-subtle
                                 transition hover:border-danger hover:text-danger
                                 disabled:opacity-50">Delete</button>
                </li>
              }
            </ul>
          }
        } @else {
          <p class="text-sm text-fg-subtle">Loading…</p>
        }
      }
    </div>
  `,
})
export class EncounterList {

  private readonly api = inject(BoardService);
  private readonly router = inject(Router);
  private readonly shellAuth = inject(ShellAuthService);

  private readonly user = toSignal(this.shellAuth.user$);

  /** The same gate the finder uses, and the same one the server enforces. */
  protected readonly canEdit = computed(() =>
    (this.user()?.roles ?? []).includes('DUNGEON_MASTER'));

  protected readonly encounters = signal<EncounterSummary[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected draftName = '';

  constructor() {
    // Waits for the role rather than asking and being refused. The shell's user
    // arrives asynchronously, so a fetch in the constructor runs before anyone
    // is known — and for a signed-out visitor that is a guaranteed 401, which
    // the host answers with a "please log in again" toast over a panel that
    // has just finished explaining exactly that. Reads this signal and writes a
    // different one, so it settles.
    effect(() => {
      if (this.canEdit() && this.encounters() === null) {
        this.reload();
      }
    });
  }

  private reload(): void {
    this.api.encounters().subscribe({
      next: list => this.encounters.set(list),
      error: err => {
        this.encounters.set([]);
        this.error.set(reason(err, 'Your encounters could not be loaded.'));
      },
    });
  }

  /**
   * Makes an encounter and opens it.
   *
   * <p>The sample posts its whole board — every painted square and every piece
   * of furniture — in the one request that creates the encounter. That is worth
   * doing rather than a blank board plus a hundred follow-ups, and it is the
   * strongest check that the fixture the preview draws is something the server
   * will actually accept.
   */
  protected create(fromSample: boolean): void {
    const name = this.draftName.trim() || (fromSample ? SAMPLE_NAME : 'New encounter');
    this.busy.set(true);
    this.error.set(null);
    this.api.createEncounter(name, fromSample ? sampleMap() : undefined).subscribe({
      next: created => {
        this.busy.set(false);
        void this.router.navigate(['/board', created.id]);
      },
      error: err => {
        this.busy.set(false);
        this.error.set(reason(err, 'The encounter could not be created.'));
      },
    });
  }

  protected remove(encounter: EncounterSummary): void {
    // Deliberately not a confirm dialog: the list is small, the thing deleted
    // is a plan rather than a session's history, and a modal per row would be
    // in the way of the one action people repeat while tidying up.
    this.busy.set(true);
    this.api.deleteEncounter(encounter.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.encounters.update(list => (list ?? []).filter(e => e.id !== encounter.id));
      },
      error: err => {
        this.busy.set(false);
        this.error.set(reason(err, 'That encounter could not be deleted.'));
      },
    });
  }
}

/**
 * What went wrong, in the server's words where it gave any.
 *
 * <p>The engine answers a refused placement or an off-board square with a 400
 * and a sentence, and that sentence is more use than anything this screen could
 * invent — "A board holds at most 400 props" tells a DM what to change.
 */
function reason(error: unknown, fallback: string): string {
  const detail = (error as { error?: { detail?: string; message?: string } })?.error;
  return detail?.detail ?? detail?.message ?? fallback;
}
