import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy,
  inject, signal, viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { frameMs } from '../bab/split-frame';
import { Stage } from '../bab/stage';
import { FIELD_THEME, INDOOR_LOOK } from '../board-assets';
import { type Experiment, type Rig, experimentFor } from './experiments';
import { type Reading, grab, meanDiff } from './lab-shell';
import { type LabEntry, labFor } from './labs';

const SETTLE_MS = 900;

@Component({
  selector: 'ooze-lab-screen',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dark ooze-board block w-full' },
  styles: [`
    :host {
      display: block;
      height: calc(100vh - var(--ooze-shell-header, 3.5rem));
      height: calc(100dvh - var(--ooze-shell-header, 3.5rem));
      background: var(--color-bg);
    }
  `],
  template: `
    <div class="relative h-full w-full overflow-hidden bg-bg">
      <canvas #canvas class="absolute inset-0 h-full w-full outline-none"
        style="touch-action: none; overscroll-behavior: contain"></canvas>

      <div class="pointer-events-none absolute inset-0 z-20 flex items-start justify-between gap-2 p-2">
        <div class="pointer-events-auto flex max-w-[min(30rem,calc(100%-2rem))] flex-col gap-2
                    rounded-lg border border-rule bg-bg/85 p-3 shadow-xl backdrop-blur">
          <div class="flex items-center gap-2">
            <a [routerLink]="['board', 'lab']" [relativeTo]="root"
              class="shrink-0 rounded border border-rule px-1.5 py-0.5 font-mono text-[0.65rem] text-fg-muted hover:border-accent hover:text-accent">
              lab
            </a>
            <span class="truncate text-xs font-semibold text-fg">{{ lab()?.title ?? 'Unknown experiment' }}</span>
            <span class="ml-auto shrink-0 rounded bg-fg/10 px-1.5 font-mono text-[0.6rem] text-fg-muted">
              {{ lab()?.phase }}
            </span>
          </div>

          @if (lab(); as entry) {
            <div class="flex items-center gap-3 border-y border-rule py-2">
              <label class="flex cursor-pointer items-center gap-2 text-xs text-fg">
                <input type="checkbox" [checked]="on()" [disabled]="busy()"
                  (change)="setOn($any($event.target).checked)" />
                technique on
              </label>
              <button type="button" (click)="measure()" [disabled]="busy() || !ready()"
                class="rounded border border-rule px-2 py-0.5 font-mono text-[0.65rem] text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40">
                {{ busy() ? 'measuring…' : 'measure' }}
              </button>
              <span class="font-mono text-[0.6rem] text-fg-subtle">{{ note() }}</span>
            </div>

            @if (reading(); as r) {
              <dl class="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[0.65rem] text-fg-subtle">
                <div><dt class="inline">on</dt> <dd class="inline tabular-nums text-fg">{{ r.onMs }} ms</dd></div>
                <div><dt class="inline">off</dt> <dd class="inline tabular-nums text-fg">{{ r.offMs }} ms</dd></div>
                <div>
                  <dt class="inline">costs</dt>
                  <dd class="inline tabular-nums" [class.text-fg]="true">{{ delta(r) }} ms</dd>
                </div>
                <div><dt class="inline">changes</dt> <dd class="inline tabular-nums text-fg">{{ r.change.toFixed(2) }}</dd></div>
                <div class="col-span-2">
                  <dt class="inline">control</dt>
                  <dd class="inline tabular-nums text-fg">{{ r.control.toFixed(2) }}</dd>
                  <span class="ml-1">{{ verdict(r) }}</span>
                </div>
              </dl>
            }

            <dl class="flex flex-col gap-1 border-t border-rule pt-2 text-[0.7rem] leading-snug text-fg-subtle">
              <div><dt class="inline font-semibold text-emerald-400">Working</dt> — {{ entry.criterion.working }}</div>
              <div><dt class="inline font-semibold text-amber-400">Not helping</dt> — {{ entry.criterion.notHelping }}</div>
              <div><dt class="inline font-semibold text-rose-400">Broken</dt> — {{ entry.criterion.broken }}</div>
            </dl>

            <p class="text-[0.65rem] leading-snug text-fg-subtle">{{ entry.scene }}</p>
          }

          @if (fault(); as message) {
            <p class="font-mono text-[0.65rem] text-rose-400">{{ message }}</p>
          }
        </div>
      </div>
    </div>
  `,
})
export class LabScreen implements AfterViewInit, OnDestroy {

  protected readonly root = inject(ActivatedRoute).parent;
  protected readonly lab = signal<LabEntry | undefined>(undefined);
  protected readonly on = signal(true);
  protected readonly busy = signal(false);
  protected readonly note = signal('');
  protected readonly reading = signal<Reading | null>(null);
  protected readonly fault = signal<string | null>(null);
  protected readonly ready = signal(false);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly route = inject(ActivatedRoute);
  private stage: Stage | null = null;
  private rig: Rig | null = null;
  private observer: ResizeObserver | null = null;
  private gone = false;

  ngAfterViewInit(): void {
    void this.open(this.canvas().nativeElement);
  }

  private async open(canvas: HTMLCanvasElement): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    const entry = labFor(id);
    this.lab.set(entry);
    if (!entry) {
      this.fault.set(`No lab called "${id}".`);
      return;
    }
    let experiment: Experiment | null = null;
    try {
      experiment = await experimentFor(id);
    } catch (error) {
      this.fault.set(String((error as { message?: string })?.message ?? error));
      return;
    }
    if (!experiment) {
      this.fault.set(`"${id}" is listed but has no experiment behind it yet.`);
      return;
    }
    try {
      const stage = await Stage.open(
        canvas, FIELD_THEME.look ?? INDOOR_LOOK, FIELD_THEME.environment?.url,
      );
      if (this.gone) {
        stage.dispose();
        return;
      }
      this.stage = stage;
      const rig = await experiment(stage);
      this.rig = rig;
      rig.set(this.on());
      this.note.set(rig.note);
      this.ready.set(true);
      stage.start();
      (globalThis as unknown as Record<string, unknown>)['lab'] = {
        stage, rig, measure: (): Promise<Reading | null> => this.measure(),
      };
      this.observer = new ResizeObserver(() => stage.resize());
      this.observer.observe(canvas);
    } catch (error) {
      console.error('[lab]', error);
      this.fault.set(String((error as { message?: string })?.message ?? error));
    }
  }

  protected setOn(want: boolean): void {
    this.on.set(want);
    this.rig?.set(want);
  }

  protected delta(reading: Reading): string {
    const cost = reading.onMs - reading.offMs;
    return `${cost >= 0 ? '+' : ''}${cost.toFixed(2)}`;
  }

  protected verdict(reading: Reading): string {
    if (reading.change <= reading.control) {
      return '— the switch changes nothing the control does not. Read no further.';
    }
    return `— the switch moves ${(reading.change / Math.max(0.01, reading.control)).toFixed(1)}x the control.`;
  }

  protected async measure(): Promise<Reading | null> {
    const rig = this.rig;
    const canvas = this.stage ? this.canvas().nativeElement : null;
    if (!rig || !canvas || this.busy()) {
      return null;
    }
    this.busy.set(true);
    rig.freeze(true);
    try {
      rig.set(true);
      await settle();
      await frameMs();
      const onMs = await frameMs();
      const onShot = await grab(canvas);
      const onAgain = await grab(canvas);

      rig.set(false);
      await settle();
      const offMs = await frameMs();
      const offShot = await grab(canvas);

      const reading: Reading = {
        onMs: round(onMs),
        offMs: round(offMs),
        change: meanDiff(onShot, offShot),
        control: meanDiff(onShot, onAgain),
      };
      this.reading.set(reading);
      return reading;
    } finally {
      rig.set(this.on());
      rig.freeze(false);
      this.busy.set(false);
    }
  }

  ngOnDestroy(): void {
    this.gone = true;
    this.observer?.disconnect();
    this.rig?.dispose();
    this.stage?.dispose();
  }
}

function settle(): Promise<void> {
  return new Promise(done => window.setTimeout(done, SETTLE_MS));
}

function round(ms: number): number {
  return Number(ms.toFixed(2));
}
