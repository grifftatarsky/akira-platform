import { DecimalPipe } from '@angular/common';
import { Color3 } from '@babylonjs/core/Maths/math.color';
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
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/loaders/glTF/2.0';
import { loadFoliage } from './foliage-cards';
import { plantScans, scatterStone } from './standing';

/** One switchable piece of the board. */
type Part = 'meadow' | 'trees' | 'stones' | 'shadows' | 'taa' | 'relief'
  | 'sky' | 'grade' | 'bloom';
import { type Meadow, sowMeadow } from './meadow';
import { PlantPreview } from './plant-preview';
import { type Plant, MEADOW, plantTriangles } from './species';
import { type Slice, splitFrame } from './split-frame';
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
  imports: [DecimalPipe, PlantPreview],
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

      <!-- <b>One switch per piece of work, so each can be judged on its own.</b>
           Every one of these was argued about from a screenshot with everything
           else switched on, which is how three of them shipped wrong. -->
      <div class="flex flex-wrap items-center gap-3 font-mono text-[0.65rem] text-fg-subtle">
        <span class="uppercase tracking-widest">show</span>
        @for (part of parts; track part.key) {
          <label class="flex items-center gap-1" [title]="part.note">
            <input type="checkbox" [checked]="on()[part.key] !== false"
              (change)="toggle(part.key, $any($event.target).checked)" />
            {{ part.label }}
          </label>
        }
      </div>

      <div class="flex flex-wrap items-center gap-3 font-mono text-[0.65rem] text-fg-subtle">
        <span class="uppercase tracking-widest">probe</span>
        <label class="flex items-center gap-1">
          <input type="checkbox" [checked]="bare()"
            (change)="setBare($any($event.target).checked)" />
          hide terrain
        </label>
        <label class="flex items-center gap-1">
          <input type="checkbox" [checked]="flat()"
            (change)="setFlat($any($event.target).checked)" />
          flat light
        </label>
        <button type="button" (click)="split()" [disabled]="splitting()"
          class="rounded border border-rule px-2 py-0.5 hover:border-accent disabled:opacity-50">
          {{ splitting() ? 'measuring…' : 'split frame' }}
        </button>
        @for (slice of slices(); track slice.name) {
          <span class="tabular-nums">
            {{ slice.name }}
            <span class="text-fg">{{ slice.ms }} ms</span>
          </span>
        }
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
          <div><dt class="inline">shadow</dt> <dd class="inline tabular-nums text-fg">{{ c.shadowMs }} ms</dd></div>
          <div><dt class="inline">shaders</dt> <dd class="inline tabular-nums text-fg">{{ c.shaderMs }} ms</dd></div>
        </dl>
      }

      <div class="relative min-h-0 flex-1 overflow-hidden rounded">
        @if (!flora()) {
          <button type="button" (click)="flora.set(true)"
            class="group absolute right-0 top-0 z-20 flex w-10 flex-col items-center gap-3 rounded-l border-y border-l border-rule-strong bg-bg-muted py-3 text-fg-muted shadow-lg transition-colors hover:bg-bg-sunk hover:text-fg"
            aria-label="Open plant list">
            <span class="grid size-5 shrink-0 place-items-center rounded border border-rule-strong bg-bg text-fg-muted transition-colors group-hover:border-accent group-hover:text-accent">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" class="size-3">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span class="text-[0.6rem] font-semibold uppercase tracking-[0.2em]"
                  style="writing-mode: vertical-rl">Plants</span>
          </button>
        }

        @if (flora()) {
          <aside class="absolute inset-y-0 right-0 z-20 flex w-80 flex-col border-l border-rule bg-bg shadow-xl">
            <div class="flex h-11 shrink-0 items-center justify-between border-b border-rule px-3">
              <span class="text-sm font-semibold text-fg">Plants</span>
              <button type="button" (click)="flora.set(false)"
                class="grid size-7 place-items-center rounded text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
                aria-label="Collapse plant list">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" class="size-4">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <ooze-plant-preview [plant]="chosen()" />

              <p class="mt-2 font-mono text-[0.6rem] text-fg-subtle">
                {{ chosen().tall / 2 | number:'1.1-1' }} ft tall ·
                {{ triangles(chosen()) }} tris ·
                {{ share(chosen()) }}% of the sward ·
                {{ drawn(chosen()) | number }} drawn
              </p>
              <p class="mt-2 text-xs leading-relaxed text-fg-muted">{{ chosen().note }}</p>

              <ul class="mt-3 flex flex-col gap-1">
                @for (plant of species; track plant.id) {
                  <li>
                    <button type="button" (click)="chosen.set(plant)"
                      class="w-full rounded border px-2 py-1.5 text-left text-xs transition-colors"
                      [class.border-accent]="chosen().id === plant.id"
                      [class.text-fg]="chosen().id === plant.id"
                      [class.border-rule]="chosen().id !== plant.id"
                      [class.text-fg-muted]="chosen().id !== plant.id">
                      <span class="font-medium">{{ plant.name }}</span>
                      <span class="ml-1 font-mono text-[0.6rem] text-fg-subtle">
                        {{ share(plant) }}%
                      </span>
                    </button>
                  </li>
                }
              </ul>
            </div>
          </aside>
        }

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
  /** Collapsed by default, like the dice roller: it is a critique tool. */
  protected readonly flora = signal(false);
  protected readonly species = MEADOW;
  protected readonly chosen = signal<Plant>(MEADOW[0]);
  protected readonly fault = signal<string | null>(null);
  /**
   * The two diagnostics the report asked for before any fix.
   *
   * <p>`bare` hides the terrain and `flat` replaces every light with a uniform
   * white hemisphere. Between them they separate three explanations of the same
   * black that a screenshot cannot: shading on the blades, shadowing on the
   * blades, and correctly-shadowed ground showing through gaps in the sward.
   * Black that survives both is none of the three, and is the albedo itself.
   */
  protected readonly bare = signal(false);
  protected readonly flat = signal(false);
  protected readonly splitting = signal(false);
  protected readonly slices = signal<readonly Slice[]>([]);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private stage: Stage | null = null;
  private stats: Stats | null = null;
  private meadow: Meadow | null = null;
  private stones: Mesh[] = [];

  /**
   * The switches, and what each one is for.
   *
   * <p><b>Every piece of work on this board was judged with everything else
   * switched on.</b> That is how a shadow range drew a line across the map for
   * a week, how a temporal resolve shipped unverified, and how the trees were
   * tuned three times against a render of the previous build. A toggle per piece
   * is what makes "is this better" a question anybody can answer.
   */
  protected readonly parts: readonly { key: Part; label: string; note: string }[] = [
    { key: 'meadow', label: 'sward', note: 'The grass, clover, plantain and daisies.' },
    { key: 'trees', label: 'trees', note: 'Scanned trees and scrub.' },
    { key: 'stones', label: 'stone', note: 'Scanned fieldstone.' },
    { key: 'shadows', label: 'shadows', note: 'The sun\'s cascaded shadow map.' },
    { key: 'taa', label: 'temporal aa', note: 'The temporal resolve. Off is sharper and crawls.' },
    { key: 'relief', label: 'ground relief', note: 'The terrain normal and roughness maps.' },
    { key: 'sky', label: 'sky light', note: 'Image-based light from the sky probe.' },
    { key: 'grade', label: 'grade', note: 'Tone mapping, contrast and exposure.' },
    { key: 'bloom', label: 'bloom', note: 'Light spilling around bright edges.' },
  ];

  protected readonly on = signal<Partial<Record<Part, boolean>>>({});

  /**
   * Switches one piece of the board off and leaves the rest alone.
   *
   * <p>Each case is the smallest thing that makes that piece stop happening,
   * rather than a rebuild — so the switch can be thrown while looking at the
   * board and the answer arrives in the same second.
   */
  protected toggle(part: Part, want: boolean): void {
    this.on.update(was => ({ ...was, [part]: want }));
    const stage = this.stage;
    if (!stage) {
      return;
    }
    switch (part) {
      case 'meadow':
        this.meadow?.sown.forEach(sown => sown.mesh.setEnabled(want));
        break;
      case 'trees':
        this.stones.filter(mesh => mesh.name.startsWith('scan-'))
          .forEach(mesh => mesh.setEnabled(want));
        break;
      case 'stones':
        this.stones.filter(mesh => mesh.name.startsWith('stone-'))
          .forEach(mesh => mesh.setEnabled(want));
        break;
      case 'shadows':
        stage.setShadows(want);
        break;
      case 'taa':
        stage.setResolve(want);
        break;
      case 'relief':
        stage.setRelief(want);
        break;
      case 'sky':
        stage.setSkyLight(want);
        break;
      case 'grade':
        stage.setGrade(want);
        break;
      case 'bloom':
        stage.setBloom(want);
        break;
    }
  }
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
      const fieldAt = performance.now();
      const field = groundField(scene);
      const fieldMs = Math.round(performance.now() - fieldAt);
      const started = performance.now();
      this.terrain = buildTerrain(ground, field, stage.scene);
      // The ground casts its own shadows — a rise has to darken the hollow
      // behind it or the relief reads as a painting of relief. It is also the
      // only caster now that the meadow is not one, and a cascade generator
      // with an empty render list does not skip the pass: it samples an
      // unwritten map and returns nothing but shadow, which looks exactly like
      // a sun that has gone out.
      this.terrain.chunks.forEach(chunk => stage.shadows.addShadowCaster(chunk));
      // And the sward, as a proxy the camera never sees. The meadow itself
      // stays out of the shadow map — it is the most expensive thing that could
      // go in one — but the field it makes still has to fall across the road.
      this.terrain.swardProxy.forEach(chunk => stage.shadows.addShadowCaster(chunk));
      const built = Math.round(performance.now() - started);

      const sheet = await loadFoliage(stage.scene);
      this.meadow = sowMeadow(field, stage.scene, sheet);
      // <b>What stands above the sward, all of it scanned.</b> A dozen trees
      // on three tenths of a hectare is the open end of wood pasture; the scrub
      // takes the margins and the verge, and the stone shows where the soil is
      // thin. They cast, because a tree's shadow is the one shadow on this
      // board two cascades can resolve — and from overhead the dark patch under
      // a tree is most of what says a tree is there.
      this.stones = [
        ...await plantScans(field, stage.scene),
        ...await scatterStone(field, stage.scene),
      ];
      this.stones.forEach(stone => stage.shadows.addShadowCaster(stone));
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
      // The cascades are their own render pass, so unlike everything else on
      // the board their cost can be read from the device rather than inferred.
      const cascades = stage.shadows.getShadowMap();
      if (cascades) {
        this.stats.watch(cascades);
      }
      // Once a second: the counters are already rolling averages over exactly
      // that window, so reading them faster shows the same number more often
      // and drags change detection along for nothing.
      this.ticker = window.setInterval(() => this.cost.set(this.stats?.read() ?? null), 1000);
      this.status.set(
        `${this.terrain.chunks.length} chunks · field ${fieldMs} ms · mesh ${built} ms`,
      );

      this.observer = new ResizeObserver(() => stage.resize());
      this.observer.observe(canvas);
    } catch (error) {
      // Babylon throws bare strings in places, so `error.message` is often
      // undefined and the fallback hides the only useful thing there is.
      console.error('[board]', error);
      this.fault.set(String((error as { message?: string })?.message ?? error));
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

  /**
   * Hides the terrain, leaving the meadow standing in the sky.
   *
   * <p>If the black patches go with it, they were never on the grass: they were
   * the ground between the clumps, which the terrain legitimately shadow-maps
   * onto itself, seen through gaps that Voronoi clumping leaves by
   * construction. If they stay, they are on the blades.
   */
  protected setBare(on: boolean): void {
    this.bare.set(on);
    this.terrain?.chunks.forEach(chunk => chunk.setEnabled(!on));
  }

  /**
   * Every light replaced by one white hemisphere.
   *
   * <p>No sun means no cascade, because a cascade only ever multiplies into its
   * own light's contribution — so this removes shadowing and directional
   * shading in one move. A white ground colour matters as much as the missing
   * sun: the hemisphere's ground colour is a dark brown, so a downward normal
   * reads as black under ambient alone, and an earlier version of this test
   * turned the sun off but left the brown, which is why it proved nothing.
   */
  protected setFlat(on: boolean): void {
    this.flat.set(on);
    const stage = this.stage;
    if (!stage) {
      return;
    }
    if (on) {
      stage.sun.setEnabled(false);
      stage.bounce.setEnabled(false);
      stage.ambient.diffuse = new Color3(1, 1, 1);
      stage.ambient.groundColor = new Color3(1, 1, 1);
      stage.ambient.intensity = 1;
    } else {
      stage.sun.setEnabled(true);
      stage.bounce.setEnabled(true);
      // Puts the whole time of day back, which is what set them in the first
      // place.
      stage.setClock(this.hour());
    }
  }

  /**
   * What each part of the frame costs, measured by taking it away.
   *
   * <p>Roughly a second a group, and it visibly flickers while it runs, because
   * it is turning the board's contents off and on. That is the price of the
   * only honest answer available: terrain, meadow and sky share one WebGPU
   * render pass and no counter can separate them.
   */
  protected async split(): Promise<void> {
    const stage = this.stage;
    if (!stage || this.splitting()) {
      return;
    }
    this.splitting.set(true);
    this.slices.set([]);
    try {
      this.slices.set(await splitFrame(stage.scene, [
        { name: 'meadow', meshes: this.meadow?.sown.map(s => s.mesh) ?? [] },
        { name: 'terrain', meshes: this.terrain?.chunks ?? [] },
      ]));
    } finally {
      this.splitting.set(false);
    }
  }

  protected triangles(plant: Plant): number {
    return plantTriangles(plant);
  }

  protected share(plant: Plant): number {
    const total = MEADOW.reduce((sum, p) => sum + p.share, 0);
    return Math.round((plant.share / total) * 100);
  }

  /** How many of this species are actually on the board right now. */
  protected drawn(plant: Plant): number {
    return this.meadow?.sown.find(s => s.plant.id === plant.id)?.count ?? 0;
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
    this.stones.forEach(stone => stone.dispose());
    this.meadow?.dispose();
    this.terrain?.dispose();
    this.stage?.dispose();
  }
}
