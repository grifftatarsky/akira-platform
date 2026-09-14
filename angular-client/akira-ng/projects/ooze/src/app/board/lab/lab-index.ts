import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LABS } from './labs';

@Component({
  selector: 'ooze-lab-index',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dark block w-full' },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-5 p-6">
      <header class="flex flex-col gap-2">
        <div class="flex items-baseline gap-3">
          <h1 class="text-lg font-semibold text-fg">The graphics lab</h1>
          <a [routerLink]="['board', 'bab']" [relativeTo]="root"
            class="font-mono text-[0.7rem] text-fg-muted hover:text-accent">the board →</a>
        </div>
        <p class="max-w-prose text-sm leading-relaxed text-fg-muted">
          One screen per technique, each on the smallest scene that exercises it,
          each with an A/B switch that moves one thing. The criteria below were
          written before the demo was built — that is the whole point of the
          place. A technique is accepted or refused by opening its screen and
          looking; the numbers are there to stop the argument, not to replace
          the look.
        </p>
      </header>

      <ul class="flex flex-col gap-3">
        @for (lab of labs; track lab.id) {
          <li class="rounded-lg border border-rule bg-bg/40 p-4">
            <div class="flex items-baseline gap-2">
              <a [routerLink]="['board', 'lab', lab.id]" [relativeTo]="root"
                class="text-sm font-semibold text-fg hover:text-accent">{{ lab.title }}</a>
              <span class="rounded bg-fg/10 px-1.5 font-mono text-[0.6rem] text-fg-muted">{{ lab.phase }}</span>
              <span class="ml-auto font-mono text-[0.65rem]"
                [class.text-emerald-400]="lab.result"
                [class.text-fg-subtle]="!lab.result">
                {{ lab.result ?? 'not run' }}
              </span>
            </div>
            <dl class="mt-2 flex flex-col gap-1 text-[0.75rem] leading-snug text-fg-subtle">
              <div><dt class="inline font-semibold text-emerald-400">Working</dt> — {{ lab.criterion.working }}</div>
              <div><dt class="inline font-semibold text-amber-400">Not helping</dt> — {{ lab.criterion.notHelping }}</div>
              <div><dt class="inline font-semibold text-rose-400">Broken</dt> — {{ lab.criterion.broken }}</div>
            </dl>
            <p class="mt-2 max-w-prose text-[0.75rem] leading-snug text-fg-muted">{{ lab.standard }}</p>
          </li>
        }
      </ul>
    </div>
  `,
})
export class LabIndex {
  protected readonly root = inject(ActivatedRoute).parent;
  protected readonly labs = LABS;
}
