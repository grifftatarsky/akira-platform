import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, signal,
  viewChild,
} from '@angular/core';
import { FIELD_THEME, INDOOR_LOOK } from '../board-assets';
import { sceneForEncounter } from '../board-scene';
import { groundField } from '../ground-field';
import { ROAD_NAME, roadMap } from '../road-level';
import { clockLabel } from '../sun-position';
import { Stage } from './stage';
import { type Terrain, buildTerrain } from './terrain';

/**
 * The road board, on Babylon.
 *
 * <p>Same level data, same ground field, same sun — a different renderer under
 * them. Nothing about the board's *content* moved, which is the point: the
 * files that describe where the road wanders and how worn it is never named a
 * renderer, so they did not have to be touched.
 */
@Component({
  selector: 'ooze-bab-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full w-full min-h-0' },
  template: `
    <div class="flex h-[calc(100vh-8rem)] w-full flex-col gap-2 p-2">
      <div class="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
        <span class="font-semibold text-fg">{{ name }}</span>
        <span class="text-fg-subtle">Babylon.js · WebGPU</span>
        <label class="flex items-center gap-2">
          Time
          <input
            type="range" min="4" max="21" step="0.25"
            [value]="hour()" (input)="setHour($any($event.target).valueAsNumber)"
            class="w-40" />
          <span class="tabular-nums">{{ clock() }}</span>
        </label>
        <span class="tabular-nums text-fg-subtle">{{ status() }}</span>
      </div>

      <div class="relative min-h-0 flex-1 overflow-hidden rounded">
        <canvas #canvas class="h-full w-full outline-none"></canvas>
        @if (fault(); as message) {
          <p class="absolute inset-x-0 top-1/2 px-6 text-center text-sm text-fg">
            {{ message }}
          </p>
        }
      </div>
    </div>
  `,
})
export class BabBoard implements AfterViewInit, OnDestroy {

  protected readonly name = ROAD_NAME;
  protected readonly hour = signal(13);
  protected readonly clock = signal(clockLabel(13));
  protected readonly status = signal('starting…');
  protected readonly fault = signal<string | null>(null);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private stage: Stage | null = null;
  private gone = false;
  private terrain: Terrain | null = null;
  private observer: ResizeObserver | null = null;

  // Not an `effect`. A signal effect on a `viewChild` is a race — it can run
  // before the view exists, and then `viewChild.required` throws inside the
  // effect where the component's own try/catch cannot see it. Which is exactly
  // what happened: the board started once and then stopped starting.
  ngAfterViewInit(): void {
    void this.open(this.canvas().nativeElement);
  }

  private async open(canvas: HTMLCanvasElement): Promise<void> {
    if (this.stage) {
      return;
    }
    try {
      const theme = FIELD_THEME;
      const stage = await Stage.open(
        canvas, theme.look ?? INDOOR_LOOK, theme.environment?.url,
      );
      if (this.gone) {
        // The view went away while the device was being acquired. Hand it
        // straight back rather than leaving it outstanding.
        stage.dispose();
        return;
      }
      this.stage = stage;

      const scene = sceneForEncounter({
        id: 'road',
        name: ROAD_NAME,
        map: { id: 'road-map', ...roadMap() },
        combatants: [],
      });
      const field = groundField(scene);
      const started = performance.now();
      this.terrain = buildTerrain(
        theme.ground as never, field, stage.scene,
      );
      const built = Math.round(performance.now() - started);

      stage.frame(
        field.extentXHalfFeet / 2, field.extentYHalfFeet / 2, 0,
        Math.max(field.extentXHalfFeet, field.extentYHalfFeet),
      );
      // So the scene can be probed from the console. Deep imports mean there
      // is no global BABYLON to reach for, and a board that cannot be
      // inspected does not get measured.
      (globalThis as unknown as Record<string, unknown>)['bab'] = { stage, terrain: this.terrain, field };
      stage.start();
      this.status.set(
        `${this.terrain.chunks.length} chunks · built in ${built} ms`,
      );

      this.observer = new ResizeObserver(() => stage.resize());
      this.observer.observe(canvas);
    } catch (error) {
      this.fault.set(
        error instanceof Error ? error.message : 'The board could not start.',
      );
    }
  }

  protected setHour(hour: number): void {
    this.hour.set(hour);
    this.clock.set(clockLabel(hour));
    this.stage?.setClock(hour);
  }

  ngOnDestroy(): void {
    this.gone = true;
    this.observer?.disconnect();
    this.terrain?.dispose();
    this.stage?.dispose();
  }
}
