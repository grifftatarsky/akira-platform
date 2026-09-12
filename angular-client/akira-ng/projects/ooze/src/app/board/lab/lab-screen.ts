import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy,
  inject, signal, viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { framePasses } from '../bab/gpu-passes';
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
              <div class="flex flex-wrap items-center gap-1">
                @for (option of options(); track option; let at = $index) {
                  <button type="button" (click)="setPick(at)" [disabled]="busy()"
                    class="rounded border px-2 py-0.5 font-mono text-[0.65rem] disabled:opacity-40"
                    [class.border-accent]="pick() === at"
                    [class.text-accent]="pick() === at"
                    [class.border-rule]="pick() !== at"
                    [class.text-fg-muted]="pick() !== at">
                    {{ option }}{{ at === 0 ? ' (baseline)' : '' }}
                  </button>
                }
              </div>
              <button type="button" (click)="measure()" [disabled]="busy() || !ready()"
                class="rounded border border-rule px-2 py-0.5 font-mono text-[0.65rem] text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40">
                {{ busy() ? 'measuring…' : 'measure' }}
              </button>
              <span class="font-mono text-[0.6rem] text-fg-subtle">{{ note() }}</span>
            </div>

            @if (readings().length) {
              <table class="w-full font-mono text-[0.65rem] text-fg-subtle">
                <thead>
                  <tr class="text-left text-fg-faint">
                    <th class="pr-3 font-normal">option</th>
                    <th class="pr-3 font-normal">wall</th>
                    <th class="pr-3 font-normal">scene</th>
                    <th class="pr-3 font-normal">vs baseline</th>
                    <th class="pr-3 font-normal">changes</th>
                    <th class="font-normal">control</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of readings(); track r.name) {
                    <tr>
                      <td class="pr-3 text-fg">{{ r.name }}</td>
                      <td class="pr-3 tabular-nums text-fg">{{ r.ms }}</td>
                      <td class="pr-3 tabular-nums text-fg">{{ r.sceneMs }}</td>
                      <td class="pr-3 tabular-nums text-fg">{{ r.costs }}</td>
                      <td class="pr-3 tabular-nums text-fg">{{ r.change }}</td>
                      <td class="tabular-nums text-fg">{{ r.control }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              <p class="font-mono text-[0.6rem] text-fg-subtle">{{ verdict() }}</p>
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
  protected readonly options = signal<readonly string[]>([]);
  protected readonly pick = signal(0);
  protected readonly busy = signal(false);
  protected readonly note = signal('');
  protected readonly readings = signal<readonly Reading[]>([]);
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
      this.options.set(rig.options);
      this.pick.set(0);
      rig.pick(0);
      this.note.set(rig.note);
      this.ready.set(true);
      stage.start();
      (globalThis as unknown as Record<string, unknown>)['lab'] = {
        stage, rig, measure: (): Promise<readonly Reading[]> => this.measure(),
      };
      this.observer = new ResizeObserver(() => stage.resize());
      this.observer.observe(canvas);
    } catch (error) {
      console.error('[lab]', error);
      this.fault.set(String((error as { message?: string })?.message ?? error));
    }
  }

  private sceneMs(): number {
    const scene = this.stage?.scene;
    return scene
      ? framePasses(scene).find(pass => pass.name === 'scene')?.ms ?? 0
      : 0;
  }

  protected setPick(at: number): void {
    this.pick.set(at);
    this.rig?.pick(at);
  }

  protected verdict(): string {
    const seen = this.readings();
    if (!seen.length) {
      return '';
    }
    const clamped = seen.every(r => Math.abs(r.ms - seen[0].ms) < 0.35);
    const dead = seen.slice(1).filter(r => r.change <= r.control);
    if (clamped) {
      return 'Wall clock is the same for every option — the scene finishes inside '
        + 'the refresh, so read the scene column, not the wall column.';
    }
    if (dead.length) {
      return `${dead.map(r => r.name).join(', ')} changed nothing the control did not. `
        + 'Read no further on those.';
    }
    return 'Every option moves the image further than the control does.';
  }

  protected async measure(): Promise<readonly Reading[]> {
    const rig = this.rig;
    const canvas = this.stage ? this.canvas().nativeElement : null;
    if (!rig || !canvas || this.busy()) {
      return [];
    }
    this.busy.set(true);
    rig.freeze(true);
    this.readings.set([]);
    try {
      rig.pick(0);
      await settle();
      await frameMs();
      const baseMs = await frameMs();
      const baseShot = await grab(canvas);
      const baseAgain = await grab(canvas);
      const baseScene = this.sceneMs();
      const seen: Reading[] = [{
        name: rig.options[0],
        ms: round(baseMs),
        sceneMs: baseScene,
        costs: '—',
        change: 0,
        control: round(meanDiff(baseShot, baseAgain)),
      }];

      for (let at = 1; at < rig.options.length; at++) {
        rig.pick(at);
        await settle();
        await frameMs();
        const ms = await frameMs();
        const shot = await grab(canvas);
        const again = await grab(canvas);
        const sceneMs = this.sceneMs();
        seen.push({
          name: rig.options[at],
          ms: round(ms),
          sceneMs,
          costs: `${sign(ms - baseMs)} wall · ${sign(sceneMs - baseScene)} scene`,
          change: round(meanDiff(shot, baseShot)),
          control: round(meanDiff(shot, again)),
        });
      }
      this.readings.set(seen);
      return seen;
    } finally {
      rig.pick(this.pick());
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

function sign(ms: number): string {
  return `${ms >= 0 ? '+' : ''}${ms.toFixed(2)}`;
}

function round(ms: number): number {
  return Number(ms.toFixed(2));
}
