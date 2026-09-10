import { DecimalPipe } from '@angular/common';
import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, signal,
  viewChild,
} from '@angular/core';
import { FIELD_THEME, INDOOR_LOOK, type SplatGround } from '../board-assets';
import { sceneForEncounter } from '../board-scene';
import { groundField } from '../ground-field';
import { ROAD_NAME, roadMap } from '../road-level';
import { clockLabel } from '../sun-position';
import { assetUrl } from './assets';
import { type Meadow, sowMeadow } from './meadow';
import { Stage } from './stage';
import { type FrameCost, Stats } from './stats';
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
  imports: [DecimalPipe],
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
        <label class="flex items-center gap-2">
          Grass
          <input
            type="range" min="0" max="100" step="1"
            [value]="density()" (input)="setDensity($any($event.target).valueAsNumber)"
            class="w-32" />
          <span class="tabular-nums">{{ density() }}%</span>
        </label>
        <span class="tabular-nums text-fg-subtle">{{ status() }}</span>
        <button type="button" (click)="inspect()"
          class="rounded border border-rule px-2 py-0.5 hover:border-accent">
          Inspector
        </button>
      </div>

      @if (cost(); as c) {
        <dl class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.65rem] text-fg-subtle">
          <div><dt class="inline">fps</dt> <dd class="inline tabular-nums text-fg">{{ c.fps }}</dd></div>
          <div>
            <dt class="inline">gpu</dt>
            <dd class="inline tabular-nums text-fg">
              {{ c.gpuMs ? c.gpuMs + ' ms' : 'not measured' }}
            </dd>
          </div>
          <div><dt class="inline">frame</dt> <dd class="inline tabular-nums text-fg">{{ c.frameMs }} ms</dd></div>
          <div><dt class="inline">cull</dt> <dd class="inline tabular-nums text-fg">{{ c.cullMs }} ms</dd></div>
          <div><dt class="inline">draws</dt> <dd class="inline tabular-nums text-fg">{{ c.drawCalls }}</dd></div>
          <div><dt class="inline">meshes</dt> <dd class="inline tabular-nums text-fg">{{ c.activeMeshes }}</dd></div>
          <div><dt class="inline">tris</dt> <dd class="inline tabular-nums text-fg">{{ c.triangles | number }}</dd></div>
          <div><dt class="inline">shaders</dt> <dd class="inline tabular-nums text-fg">{{ c.shaderMs }} ms</dd></div>
        </dl>
      }

      <div class="relative min-h-0 flex-1 overflow-hidden rounded">
        <canvas #canvas class="h-full w-full outline-none"
          style="touch-action: none; overscroll-behavior: contain"></canvas>
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
  protected readonly cost = signal<FrameCost | null>(null);
  protected readonly density = signal(50);
  protected readonly fault = signal<string | null>(null);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private stage: Stage | null = null;
  private stats: Stats | null = null;
  private meadow: Meadow | null = null;
  private ticker = 0;
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
      const ground = theme.ground as SplatGround;
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
      this.terrain = buildTerrain(ground, field, stage.scene);
      // The ground casts its own shadows — a rise has to darken the hollow
      // behind it or the relief reads as a painting of relief. It is also the
      // only caster now that the meadow is not one, and a cascade generator
      // with an empty render list does not skip the pass: it samples an
      // unwritten map and returns nothing but shadow, which looks exactly like
      // a sun that has gone out.
      this.terrain.chunks.forEach(chunk => stage.shadows.addShadowCaster(chunk));
      const built = Math.round(performance.now() - started);

      this.meadow = sowMeadow(field, stage.scene, assetUrl(ground.layers[0].color));
      // <b>The meadow does not cast shadows.</b> Six hundred thousand blades
      // rendered again into every shadow cascade is the most expensive thing
      // on the board, and it is paid whenever the camera moves — because that
      // is when cascades refit — which is exactly the moment it is felt as lag
      // rather than seen as a frame rate. It is also what *Ghost of Tsushima*
      // does: grass casts no real shadow there either, and nobody has ever
      // written about the shadows the grass in that game does not have. It
      // still receives them, which is the half that reads.
      // The wind is a re-sow, so it happens once a frame before anything is
      // drawn. Six hundred thousand threads that each write four vec4s; the
      // GPU does not notice, and nothing touches the main thread.
      stage.scene.onBeforeRenderObservable.add(() => {
        this.meadow?.step(performance.now() / 1000);
      });

      stage.frame(
        field.extentXHalfFeet / 2, field.extentYHalfFeet / 2, 0,
        Math.max(field.extentXHalfFeet, field.extentYHalfFeet),
      );
      // So the scene can be probed from the console. Deep imports mean there
      // is no global BABYLON to reach for, and a board that cannot be
      // inspected does not get measured.
      (globalThis as unknown as Record<string, unknown>)['bab'] =
        { stage, terrain: this.terrain, meadow: this.meadow, field };
      stage.start();
      this.stats = new Stats(stage.scene);
      // Once a second: the counters are already rolling averages over exactly
      // that window, so reading them faster shows the same number more often
      // and drags change detection along for nothing.
      this.ticker = window.setInterval(() => this.cost.set(this.stats?.read() ?? null), 1000);
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

  /**
   * Babylon's own debug layer, loaded only when asked for.
   *
   * <p>Two megabytes of React that has no business in the board's chunk until
   * somebody wants it — and when they do, it is the tool that would have found
   * a 93 ms ground shader in about a minute.
   */
  protected async inspect(): Promise<void> {
    const scene = this.stage?.scene;
    if (!scene) {
      return;
    }
    await import('@babylonjs/inspector');
    if (scene.debugLayer.isVisible()) {
      scene.debugLayer.hide();
    } else {
      await scene.debugLayer.show({ embedMode: true, overlay: true });
    }
  }

  protected setDensity(percent: number): void {
    this.density.set(percent);
    // Not a rebuild. The blades are already in the buffer and this is how many
    // of them get drawn — which is the whole reason the placement moved to a
    // compute pass.
    this.meadow?.setDensity(percent / 100);
  }

  protected setHour(hour: number): void {
    this.hour.set(hour);
    this.clock.set(clockLabel(hour));
    this.stage?.setClock(hour);
  }

  ngOnDestroy(): void {
    this.gone = true;
    window.clearInterval(this.ticker);
    this.stats?.dispose();
    this.observer?.disconnect();
    this.meadow?.dispose();
    this.terrain?.dispose();
    this.stage?.dispose();
  }
}
