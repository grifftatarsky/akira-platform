import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { INDOOR_LOOK } from '../board-assets';
import { sceneForEncounter } from '../board-scene';
import { SAMPLE_NAME, sampleMap } from '../sample-level';
import { type Dungeon, buildDungeon } from './dungeon';
import { Stage } from './stage';
import { type FrameCost, Stats } from './stats';

@Component({
  selector: 'ooze-bab-dungeon',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full w-full min-h-0' },
  template: `
    <div class="flex h-[calc(100vh-8rem)] w-full flex-col gap-2 p-2">
      <div class="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
        <span class="font-semibold text-fg">{{ name }}</span>
        <span class="text-fg-subtle">Babylon.js · WebGPU · clustered lighting</span>
        <span class="tabular-nums text-fg-subtle">{{ status() }}</span>
      </div>

      @if (cost(); as c) {
        <dl class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.65rem] text-fg-subtle">
          <div><dt class="inline">fps</dt> <dd class="inline tabular-nums text-fg">{{ c.fps }}</dd></div>
          <div><dt class="inline">wall</dt> <dd class="inline tabular-nums text-fg">{{ c.wallMs }} ms</dd></div>
          <div><dt class="inline">frame</dt> <dd class="inline tabular-nums text-fg">{{ c.cpuMs }} ms</dd></div>
          <div><dt class="inline">draws</dt> <dd class="inline tabular-nums text-fg">{{ c.drawCalls }}</dd></div>
          <div><dt class="inline">tris</dt> <dd class="inline tabular-nums text-fg">{{ c.triangles | number }}</dd></div>
        </dl>
      }

      <div class="relative min-h-0 flex-1 overflow-hidden rounded">
        <canvas #canvas class="h-full w-full outline-none"
          style="touch-action: none; overscroll-behavior: contain"></canvas>
        @if (fault(); as message) {
          <p class="absolute inset-x-0 top-1/2 px-6 text-center text-sm text-fg">{{ message }}</p>
        }
      </div>
    </div>
  `,
})
export class BabDungeon implements AfterViewInit, OnDestroy {

  protected readonly name = SAMPLE_NAME;
  protected readonly status = signal('starting…');
  protected readonly cost = signal<FrameCost | null>(null);
  protected readonly fault = signal<string | null>(null);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private stage: Stage | null = null;
  private dungeon: Dungeon | null = null;
  private stats: Stats | null = null;
  private ticker = 0;
  private observer: ResizeObserver | null = null;
  private gone = false;

  ngAfterViewInit(): void {
    void this.open(this.canvas().nativeElement);
  }

  private async open(canvas: HTMLCanvasElement): Promise<void> {
    if (this.stage) {
      return;
    }
    try {
      const stage = await Stage.open(canvas, INDOOR_LOOK, undefined, true);
      if (this.gone) {
        stage.dispose();
        return;
      }
      this.stage = stage;

      const scene = sceneForEncounter({
        id: 'undercroft',
        name: SAMPLE_NAME,
        map: { id: 'undercroft-map', ...sampleMap() },
        combatants: [],
      });
      const started = performance.now();
      this.dungeon = buildDungeon(scene, stage.scene);
      const built = Math.round(performance.now() - started);

      stage.frame(
        scene.widthHalfFeet / 2, scene.heightHalfFeet / 2, 0,
        Math.max(scene.widthHalfFeet, scene.heightHalfFeet),
      );
      (globalThis as unknown as Record<string, unknown>)['bab'] =
        { stage, dungeon: this.dungeon, scene };
      stage.start();
      this.stats = new Stats(stage.scene);
      this.ticker = window.setInterval(() => this.cost.set(this.stats?.read() ?? null), 1000);
      this.status.set(
        `${this.dungeon.lights} torches · `
        + `${this.dungeon.cluster ? 'clustered' : 'NOT clustered'} · built in ${built} ms`,
      );

      this.observer = new ResizeObserver(() => stage.resize());
      this.observer.observe(canvas);
    } catch (error) {
      this.fault.set(
        error instanceof Error ? error.message : 'The board could not start.',
      );
    }
  }

  ngOnDestroy(): void {
    this.gone = true;
    window.clearInterval(this.ticker);
    this.observer?.disconnect();
    this.stats?.dispose();
    this.dungeon?.dispose();
    this.stage?.dispose();
  }
}
