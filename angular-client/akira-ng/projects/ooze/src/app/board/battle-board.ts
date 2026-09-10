import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed,
  effect, input, output, signal, viewChild,
} from '@angular/core';
import { Battle, BoardScene, Encounter } from './board.models';
import { BoardRenderer, CameraMode } from './board-renderer';
import { BoardTheme, KAYKIT_THEME } from './board-assets';
import { PointerStart, dropAt, gestureFor, pathBetween, zoomAfterWheel } from './board-gestures';
import { cellSize, sceneForBattle, sceneForEncounter } from './board-scene';
import { clockLabel, dateLabel, latitudeName } from './sun-position';

/**
 * The tactical board.
 *
 * <p>Renders an encounter, or a battle running on one. The scene is built by
 * pure functions and handed to a renderer that owns the canvas; this component
 * is the seam between Angular's world and one that has a render loop.
 *
 * <p><b>The renderer is created after the view and destroyed with it</b>, and
 * never inside an effect that reads a signal it writes — the JPSS lesson, which
 * cost an afternoon and is written into CLAUDE.md.
 */
@Component({
  selector: 'ooze-battle-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // A custom element is display:inline with no height by default, so every
  // percentage height inside it resolves against nothing and the canvas grows
  // until it drives the page — 7 155 CSS pixels, in this case. The host has to
  // be a block with a height before anything below it can have one.
  host: { class: 'block h-full w-full min-h-0' },
  template: `
    <div class="relative h-full w-full min-h-0 overflow-hidden rounded-lg border border-rule
                bg-bg-subtle">
      <!--
        Absolutely positioned, never h-full. A canvas is a replaced element: give
        it a percentage height inside a parent whose height comes from its
        content and the two chase each other — the canvas grew to 14 467 CSS
        pixels before this was pinned down. Taking it out of flow means the
        container's height is the only input, and the ResizeObserver feeds that
        to the drawing buffer.
      -->
      <canvas #canvas
              class="absolute inset-0 block h-full w-full touch-none"
              [class.cursor-grabbing]="dragging()"
              [class.cursor-grab]="!dragging()"
              (pointerdown)="onPointerDown($event)"
              (pointermove)="onPointerMove($event)"
              (pointerup)="onPointerUp($event)"
              (pointercancel)="onPointerCancel()"
              (pointerleave)="onPointerLeave()"
              (wheel)="onWheel($event)"
              (contextmenu)="$event.preventDefault()"></canvas>

      <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between
                  gap-2 p-2">
        <div class="pointer-events-auto rounded-md border border-rule bg-bg/85 px-2 py-1
                    text-[0.7rem] text-fg-muted backdrop-blur">
          @if (battle(); as b) {
            Round {{ b.round }} · {{ phaseLabel() }}
          } @else {
            {{ encounter()?.name }}
          }
        </div>

        <div class="pointer-events-auto flex items-center gap-2">
          <!--
            Both options shown with the active one marked, rather than one
            button carrying the current mode. A lone button labelled "Top-down"
            is genuinely ambiguous — it reads equally as "you are looking from
            above" and as "click to look from above" — and a camera control is a
            bad place to make someone find out by pressing it.
          -->
          <div role="group" aria-label="Camera"
               class="flex overflow-hidden rounded-md border border-rule bg-bg/85 backdrop-blur">
            @for (mode of cameraModes; track mode.id) {
              <button type="button"
                      (click)="setCamera(mode.id)"
                      [attr.aria-pressed]="cameraMode() === mode.id"
                      [class]="cameraMode() === mode.id
                        ? 'bg-accent/15 text-accent'
                        : 'text-fg-subtle hover:text-fg'"
                      class="px-2 py-1 text-[0.7rem] font-medium transition">
                {{ mode.label }}
              </button>
            }
          </div>

          @if (hasClock()) {
            <button type="button" (click)="openPanel('plants')"
                    [attr.aria-expanded]="panel() === 'plants'"
                    [class]="panel() === 'plants'
                      ? 'bg-accent/15 text-accent' : 'text-fg-subtle hover:text-fg'"
                    class="rounded-md border border-rule bg-bg/85 px-2 py-1 text-[0.7rem]
                           font-medium backdrop-blur transition"
                    title="What grows on the ground">Plants</button>

            <button type="button" (click)="openPanel('sun')"
                    [attr.aria-expanded]="panel() === 'sun'"
                    [class]="panel() === 'sun'
                      ? 'bg-accent/15 text-accent' : 'text-fg-subtle hover:text-fg'"
                    class="rounded-md border border-rule bg-bg/85 px-2 py-1 text-[0.7rem]
                           font-medium tabular-nums backdrop-blur transition"
                    title="Where the sun is">Sun · {{ clock() }}</button>
          }

          <button type="button" (click)="toggleStats()"
                  [attr.aria-pressed]="!!stats()"
                  [class]="stats() ? 'bg-accent/15 text-accent' : 'text-fg-subtle hover:text-fg'"
                  class="rounded-md border border-rule bg-bg/85 px-2 py-1 text-[0.7rem]
                         font-medium backdrop-blur transition"
                  title="Frame rate, draw calls, triangles">Stats</button>

          <button type="button" (click)="toggleGrid()"
                  [attr.aria-pressed]="grid()"
                  [class]="grid() ? 'bg-accent/15 text-accent' : 'text-fg-subtle hover:text-fg'"
                  class="rounded-md border border-rule bg-bg/85 px-2 py-1 text-[0.7rem]
                         font-medium backdrop-blur transition"
                  title="Five-foot squares">Grid</button>

          <button type="button" (click)="toggleEffects()"
                  [attr.aria-pressed]="effects()"
                  [class]="effects() ? 'bg-accent/15 text-accent' : 'text-fg-subtle hover:text-fg'"
                  class="rounded-md border border-rule bg-bg/85 px-2 py-1 text-[0.7rem]
                         font-medium backdrop-blur transition"
                  title="Ambient occlusion and bloom">Effects</button>

          <div class="flex overflow-hidden rounded-md border border-rule bg-bg/85 backdrop-blur">
            <button type="button" (click)="zoomBy(0.8)" aria-label="Zoom in"
                    class="px-2 py-1 text-[0.7rem] text-fg-subtle transition hover:text-fg">+</button>
            <button type="button" (click)="zoomBy(1.25)" aria-label="Zoom out"
                    class="border-l border-rule px-2 py-1 text-[0.7rem] text-fg-subtle transition
                           hover:text-fg">−</button>
            <button type="button" (click)="recentre()"
                    class="border-l border-rule px-2 py-1 text-[0.7rem] text-fg-subtle transition
                           hover:text-fg">Centre</button>
          </div>
        </div>
      </div>

      @if (!scene()) {
        <p class="absolute inset-0 grid place-items-center text-xs text-fg-subtle">
          Nothing placed yet.
        </p>
      }

      @if (stats(); as s) {
        <p class="pointer-events-none absolute left-2 top-11 rounded-md border border-rule
                  bg-bg/85 px-2 py-1 font-mono text-[0.65rem] leading-relaxed text-fg-muted
                  backdrop-blur">
          {{ s.fps }} fps · {{ s.calls }} draws<br />
          {{ s.tris }} · {{ s.buffer }}<br />
          {{ s.plants }} growing
        </p>
      }

      <!--
        Every row says what it does in the terms the change will be seen in, not
        in the terms it is stored in. "Latitude 51" is a number a DM has to look
        up; "about London" is the thing they were picturing when they reached
        for the control. And the summary at the bottom reports what the board
        will actually look like — how long the shadows are and which way they
        fall — because a panel that only reads its own settings back is telling
        somebody what they just typed.
      -->
      @if (panel() === 'sun' && hasClock()) {
        <div class="pointer-events-auto absolute right-2 top-11 w-64 rounded-md border
                    border-rule bg-bg/95 p-3 text-[0.7rem] text-fg-muted shadow-lg
                    backdrop-blur">
          <p class="mb-2 font-semibold text-fg">The sun</p>

          <label class="mb-3 block">
            <span class="flex items-baseline justify-between">
              <span class="font-medium text-fg">Time</span>
              <span class="tabular-nums">{{ clock() }}</span>
            </span>
            <input type="range" min="4" max="21" step="0.25"
                   [value]="hour()" (input)="setHour($event)"
                   aria-label="Time of day"
                   class="mt-1 h-1 w-full cursor-pointer accent-accent" />
            <span class="text-fg-subtle">Carries it across the sky, east to west.</span>
          </label>

          <label class="mb-3 block">
            <span class="flex items-baseline justify-between">
              <span class="font-medium text-fg">Season</span>
              <span class="tabular-nums">{{ date() }}</span>
            </span>
            <input type="range" min="1" max="365" step="1"
                   [value]="dayOfYear()" (input)="setDay($event)"
                   aria-label="Day of the year"
                   class="mt-1 h-1 w-full cursor-pointer accent-accent" />
            <span class="text-fg-subtle">How high it climbs at midday. Summer high, winter low.</span>
          </label>

          <label class="mb-3 block">
            <span class="flex items-baseline justify-between">
              <span class="font-medium text-fg">How far north</span>
              <span class="tabular-nums">{{ place() }}</span>
            </span>
            <input type="range" min="0" max="66" step="0.5"
                   [value]="latitude()" (input)="setLatitude($event)"
                   aria-label="Latitude"
                   class="mt-1 h-1 w-full cursor-pointer accent-accent" />
            <span class="text-fg-subtle">Nearer the pole, the lower the sun stays all day.</span>
          </label>

          <label class="mb-3 flex items-start gap-2">
            <input type="checkbox" [checked]="adaptive()" (change)="setAdaptive($event)"
                   class="mt-0.5 accent-accent" />
            <span>
              <span class="font-medium text-fg">Let the eye adjust</span><br />
              <span class="text-fg-subtle">Opens up as the light falls, so evening stays
                a scene you can play on instead of going black.</span>
            </span>
          </label>

          <p class="border-t border-rule pt-2 text-fg">{{ sunSummary() }}</p>
        </div>
      }

      @if (panel() === 'plants' && hasClock()) {
        <div class="pointer-events-auto absolute right-2 top-11 w-64 rounded-md border
                    border-rule bg-bg/95 p-3 text-[0.7rem] text-fg-muted shadow-lg
                    backdrop-blur">
          <p class="mb-2 font-semibold text-fg">What grows here</p>

          <!--
            Fires on release, not while dragging. At six times the theme's
            spacing this rebuilds three million plants, and a slider that did
            that per pixel of travel would lock the tab.
          -->
          <label class="mb-3 block">
            <span class="flex items-baseline justify-between">
              <span class="font-medium text-fg">How thick</span>
              <span class="tabular-nums">{{ spread().toFixed(1) }}×</span>
            </span>
            <input type="range" min="0.2" max="6" step="0.2"
                   [value]="spread()" (input)="spread.set(+$any($event.target).value)"
                   (change)="setSpread($event)"
                   aria-label="How thickly plants grow"
                   class="mt-1 h-1 w-full cursor-pointer accent-accent" />
            <span class="text-fg-subtle">Plants per square foot. The board is rebuilt when
              you let go — turn the readout on to see what it costs.</span>
          </label>

          <!--
            Dragged live, unlike the other two: the wind is a uniform read by
            the vertex shader, so nothing is rebuilt to change it.
          -->
          <label class="mb-3 block">
            <span class="flex items-baseline justify-between">
              <span class="font-medium text-fg">Wind</span>
              <span class="tabular-nums">{{ windLabel() }}</span>
            </span>
            <input type="range" min="0" max="1" step="0.05"
                   [value]="wind()" (input)="setWind($event)"
                   aria-label="How hard the wind blows"
                   class="mt-1 h-1 w-full cursor-pointer accent-accent" />
            <span class="text-fg-subtle">Gusts cross the field in patches, with lulls
              between. All the way down is a still day.</span>
          </label>

          <label class="flex items-start gap-2">
            <input type="checkbox" [checked]="mixed()" (change)="toggleMixed()"
                   class="mt-0.5 accent-accent" />
            <span>
              <span class="font-medium text-fg">Mixed</span><br />
              <span class="text-fg-subtle">Clover, plantain, seed heads and flowers as well
                as grass. Off is turf; on is country.</span>
            </span>
          </label>
        </div>
      }

      @if (selectedName(); as name) {
        <p class="pointer-events-none absolute bottom-2 left-2 rounded-md border border-rule
                  bg-bg/85 px-2 py-1 text-[0.7rem] text-fg backdrop-blur">{{ name }}</p>
      }

      <p class="pointer-events-none absolute bottom-2 right-2 rounded-md border border-rule
                bg-bg/85 px-2 py-1 text-[0.65rem] text-fg-subtle backdrop-blur">
        Drag a token to move · drag the board to pan · scroll to zoom · Alt to place freely@if (cameraMode() === 'PERSPECTIVE') { · Shift-drag to orbit }
      </p>
    </div>
  `,
})
export class BattleBoard implements AfterViewInit, OnDestroy {

  readonly encounter = input<Encounter | null>(null);
  readonly battle = input<Battle | null>(null);

  /**
   * Which art pack to draw with.
   *
   * <p>An input rather than a constant, so a DM can swap or remove one without
   * the board caring. A theme with no models draws colored tiles, which is what
   * deleting a pack looks like — and what building your own starts from.
   */
  readonly theme = input<BoardTheme>(KAYKIT_THEME);

  /** A creature was clicked. */
  readonly selected = output<string | null>();

  /**
   * A creature was dragged somewhere.
   *
   * <p>Emits a whole path rather than a destination, because the engine charges
   * per square and asks per square whether the step provokes — a single hop
   * would cost the right total and open the Opportunity Attack window in the
   * wrong place, or not at all.
   */
  readonly moved = output<{ id: string; path: { xHalfFeet: number; yHalfFeet: number;
    zHalfFeet: number }[] }>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private renderer: BoardRenderer | null = null;
  private observer: ResizeObserver | null = null;

  protected readonly cameraMode = signal<CameraMode>('TOP_DOWN');

  protected readonly cameraModes: readonly { id: CameraMode; label: string }[] = [
    { id: 'TOP_DOWN', label: 'Top-down' },
    { id: 'PERSPECTIVE', label: 'Perspective' },
  ];
  /**
   * Whether the expensive passes are on.
   *
   * <p>A real control rather than a debug flag. Ambient occlusion and bloom are
   * several full-screen passes, and a board that will not hold a frame rate is
   * worse than a board that is merely lit — the environment map, the tone curve
   * and the light field all live in the scene itself and cost nothing extra, so
   * turning this off leaves the board lit and only takes away the polish.
   */
  protected readonly effects = signal(true);

  /**
   * Whether the five-foot squares are drawn.
   *
   * <p>On by default: every square is five feet of movement and the unit reach
   * and cover are counted in, so a board that hides them asks a DM to estimate
   * something the engine is being exact about. Off for a screenshot.
   */
  protected readonly grid = signal(true);

  /**
   * The time of day, where the board has a sky to have one in.
   *
   * <p>Everything about the sun follows from it — height, bearing, strength,
   * color — so this is one control rather than four, and it cannot be set to
   * something the sky does not do.
   */
  protected readonly hour = signal(13);
  protected readonly clock = computed(() => clockLabel(this.hour()));
  protected readonly hasClock = signal(false);

  /** Where in the year, and how far north — the other two things the sun answers to. */
  protected readonly dayOfYear = signal(196);
  protected readonly latitude = signal(37.5);
  protected readonly adaptive = signal(true);
  /**
   * Which side panel is open, if any.
   *
   * <p>One at a time: both hang off the same corner, and two of them stacked
   * would cover the board they exist to change.
   */
  protected readonly panel = signal<'sun' | 'plants' | null>(null);

  /** Whether the meadow grows the other four species or grass alone. */
  protected readonly mixed = signal(true);

  /** How thickly it stands, against the theme's own spacing. */
  protected readonly spread = signal(3);

  /** How hard the wind blows, from a still day to the most it was built for. */
  protected readonly wind = signal(1);
  protected readonly windLabel = computed(() => {
    const w = this.wind();
    if (w < 0.02) return 'still';
    if (w < 0.3) return 'a breath';
    if (w < 0.6) return 'a breeze';
    if (w < 0.85) return 'blowing';
    return 'gusting';
  });
  protected readonly date = computed(() => dateLabel(this.dayOfYear()));
  protected readonly place = computed(() => latitudeName(this.latitude()));

  /**
   * What the sun is doing, said in what will be visible on the board.
   *
   * <p>Recomputed off a counter the setters bump rather than off the sliders,
   * because the answer comes from the renderer — which owns the sun — and a
   * computed cannot depend on a method call.
   */
  private readonly sunTick = signal(0);
  protected readonly sunSummary = computed(() => {
    this.sunTick();
    const sun = this.renderer?.sunReadout();
    if (!sun) {
      return '';
    }
    if (sun.elevation <= 0) {
      return 'Below the horizon — no shadows, only the sky.';
    }
    const height = `${Math.round(sun.elevation)}° above the horizon`;
    if (!Number.isFinite(sun.shadow) || sun.shadow > 12) {
      return `${height}. Shadows run ${sun.bearing}, far longer than anything is tall.`;
    }
    const stretch = sun.shadow < 1
      ? `about ${Math.round(sun.shadow * 10) / 10}×`
      : `about ${Math.round(sun.shadow * 2) / 2}×`;
    return `${height}. Shadows fall ${sun.bearing}, ${stretch} as long as things are tall.`;
  });

  /**
   * What the last frame cost, while the readout is on.
   *
   * <p>Polled rather than pushed: the renderer runs its own loop outside
   * Angular on purpose, and waking change detection sixty times a second to
   * update a number nobody is reading would cost more than the number is
   * worth.
   */
  protected readonly stats = signal<
    { fps: number; calls: number; tris: string; plants: string; buffer: string } | null>(null);
  private polling = 0;

  protected readonly dragging = signal(false);
  protected readonly selectedId = signal<string | null>(null);

  private press: PointerStart | null = null;
  private last = { x: 0, y: 0 };

  protected readonly selectedName = computed(() => {
    const id = this.selectedId();
    return id ? this.scene()?.tokens.find(t => t.id === id)?.name ?? null : null;
  });

  /**
   * What to draw.
   *
   * <p>A battle wins when there is one, because a participant is where a
   * creature *is* and a combatant is where it started — drawing the second
   * during a fight would paint everyone back at their opening marks.
   */
  protected readonly scene = computed<BoardScene | null>(() => {
    const e = this.encounter();
    if (!e) {
      return null;
    }
    const b = this.battle();
    return b ? sceneForBattle(e, b) : sceneForEncounter(e);
  });

  protected readonly phaseLabel = computed(() => {
    switch (this.battle()?.phase) {
      case 'IN_TURN': return 'acting';
      case 'BETWEEN_TURNS': return 'between turns';
      case 'AWAITING_REACTION': return 'reaction window';
      case 'ROLLING_INITIATIVE': return 'rolling initiative';
      case 'ENDED': return 'over';
      default: return 'setting up';
    }
  });

  constructor() {
    // Reads the scene and writes nothing it reads. An effect that touched its
    // own signals here is exactly the bug that cleared every photo a user chose
    // in JPSS.
    effect(() => {
      const board = this.scene();
      const theme = this.theme();
      if (this.renderer) {
        this.renderer.setTheme(theme);
        this.hasClock.set(this.renderer.hasClock());
        this.readSun();
        if (board) {
          this.renderer.render(board);
        }
      }
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    this.renderer = new BoardRenderer(canvas, this.theme());
    this.observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) {
        this.renderer?.resize(box.width, box.height);
      }
    });
    this.observer.observe(canvas.parentElement ?? canvas);

    this.hasClock.set(this.renderer.hasClock());
    this.mixed.set(this.renderer.mixedPlantsOn());
    this.spread.set(this.renderer.plantSpreadValue());
    this.wind.set(this.renderer.windStrength());
    this.readSun();
    const board = this.scene();
    if (board) {
      this.renderer.render(board);
      // Frame the whole board on first sight, so a 300-foot battlefield does
      // not open showing one square of floor. The renderer defers it until the
      // ResizeObserver has given it a viewport, because framing against a
      // canvas of unknown size is how a board ends up in a letterbox.
      this.renderer.frame(board.widthHalfFeet, board.heightHalfFeet);
    }
    this.renderer.start();
  }

  ngOnDestroy(): void {
    clearInterval(this.polling);
    this.observer?.disconnect();
    // Geometries and materials hold device buffers that nothing collects for
    // us; a board rebuilt on every state change would leak until the context is
    // lost, which reads as "the tab got slow" hours later.
    this.renderer?.dispose();
    this.renderer = null;
  }

  protected toggleStats(): void {
    if (this.polling) {
      clearInterval(this.polling);
      this.polling = 0;
      this.stats.set(null);
      return;
    }
    // Twice a second: fast enough to watch a change land, slow enough that the
    // readout is legible rather than a blur of digits.
    this.polling = setInterval(() => {
      const read = this.renderer?.statistics();
      this.stats.set(read ? {
        fps: read.fps,
        calls: read.calls,
        tris: read.triangles >= 1_000_000
          ? `${(read.triangles / 1_000_000).toFixed(1)}M tris`
          : `${Math.round(read.triangles / 1000)}k tris`,
        plants: read.plants >= 1000
          ? `${Math.round(read.plants / 1000)}k plants`
          : `${read.plants} plants`,
        buffer: read.buffer,
      } : null);
    }, 500);
  }

  /** Pulls the panel's controls back into step with whatever the theme set. */
  private readSun(): void {
    const sun = this.renderer?.sunReadout();
    if (!sun) {
      return;
    }
    this.hour.set(sun.hour);
    this.dayOfYear.set(sun.dayOfYear);
    this.latitude.set(sun.latitude);
    this.adaptive.set(sun.adaptive);
    this.sunTick.update(n => n + 1);
  }

  protected openPanel(which: 'sun' | 'plants'): void {
    this.panel.set(this.panel() === which ? null : which);
  }

  protected toggleMixed(): void {
    const on = !this.mixed();
    this.mixed.set(on);
    this.renderer?.setMixedPlants(on);
  }

  protected setWind(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.wind.set(value);
    this.renderer?.setWind(value);
  }

  protected setSpread(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.spread.set(value);
    this.renderer?.setPlantSpread(value);
  }

  protected setDay(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.dayOfYear.set(value);
    this.renderer?.setDayOfYear(value);
    this.sunTick.update(n => n + 1);
  }

  protected setLatitude(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.latitude.set(value);
    this.renderer?.setLatitude(value);
    this.sunTick.update(n => n + 1);
  }

  protected setAdaptive(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.adaptive.set(on);
    this.renderer?.setAdaptive(on);
  }

  protected setHour(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.hour.set(value);
    this.renderer?.setHour(value);
    this.sunTick.update(n => n + 1);
  }

  protected toggleGrid(): void {
    const on = !this.grid();
    this.grid.set(on);
    this.renderer?.setGrid(on);
  }

  protected toggleEffects(): void {
    const on = !this.effects();
    this.effects.set(on);
    this.renderer?.setEffects(on);
  }

  protected setCamera(mode: CameraMode): void {
    this.cameraMode.set(mode);
    this.renderer?.setCameraMode(mode);
  }

  // region Pointer
  //
  // Dragging a creature moves it and dragging the ground pans, so the board
  // never needs a mode switch for the two things a DM does constantly. Which
  // one it is cannot be known on pointerdown — a press that has not travelled
  // is still a click — so the decision is deferred to the first move.

  protected onPointerDown(event: PointerEvent): void {
    const renderer = this.renderer;
    if (!renderer) {
      return;
    }
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.press = {
      x: event.clientX,
      y: event.clientY,
      tokenId: renderer.pickToken(event.clientX, event.clientY),
      panButton: event.button === 1 || event.button === 2,
    };
    this.last = { x: event.clientX, y: event.clientY };
  }

  protected onPointerMove(event: PointerEvent): void {
    const start = this.press;
    const renderer = this.renderer;
    if (!renderer) {
      return;
    }
    if (!start) {
      // Nothing is pressed, so this is only the pointer passing over. Picking
      // is a raycast against a dozen discs, which is cheaper than the frame it
      // happens in — and it is the only thing that tells a DM that a press
      // here would move a creature rather than pan the board.
      renderer.setHovered(renderer.pickToken(event.clientX, event.clientY));
      return;
    }
    const gesture = gestureFor(start, event.clientX, event.clientY);
    const dx = event.clientX - this.last.x;
    const dy = event.clientY - this.last.y;
    this.last = { x: event.clientX, y: event.clientY };

    if (gesture.kind === 'PAN') {
      this.dragging.set(true);
      // Shift orbits when the camera can; otherwise a drag on empty ground
      // always pans, which is what an overhead view can do.
      if (event.shiftKey && this.cameraMode() === 'PERSPECTIVE') {
        renderer.orbitBy(dx, dy);
      } else {
        renderer.panBy(dx, dy);
      }
    } else if (gesture.kind === 'DRAG_TOKEN') {
      this.dragging.set(true);
    }
  }

  protected onPointerUp(event: PointerEvent): void {
    const start = this.press;
    const renderer = this.renderer;
    this.press = null;
    this.dragging.set(false);
    if (!start || !renderer) {
      return;
    }
    const gesture = gestureFor(start, event.clientX, event.clientY);

    if (gesture.kind === 'CLICK') {
      this.selectedId.set(gesture.tokenId);
      this.selected.emit(gesture.tokenId);
      return;
    }
    if (gesture.kind !== 'DRAG_TOKEN') {
      return;
    }
    const ground = renderer.groundAt(event.clientX, event.clientY);
    const from = this.scene()?.tokens.find(t => t.id === gesture.tokenId);
    const map = this.encounter()?.map;
    if (!ground || !from || !map) {
      return;
    }
    // Alt buys precision rather than paying for convenience: the common case is
    // putting a creature on a square, and making that the fiddly one would be a
    // strange trade in a system built for continuous positions.
    const cell = cellSize(map);
    const to = dropAt(ground.x, ground.y, cell, event.altKey);
    this.moved.emit({
      id: gesture.tokenId,
      path: pathBetween(from.x, from.y, to.x, to.y, cell),
    });
  }

  protected onPointerCancel(): void {
    this.press = null;
    this.dragging.set(false);
    this.renderer?.setHovered(null);
  }

  /** The pointer left the board, so nothing is under it any more. */
  protected onPointerLeave(): void {
    this.renderer?.setHovered(null);
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    const r = this.renderer;
    if (r) {
      r.setZoom(zoomAfterWheel(r.zoomLevel(), event.deltaY));
    }
  }

  protected recentre(): void {
    this.renderer?.recentre();
  }

  // endregion

  protected zoomBy(factor: number): void {
    const r = this.renderer;
    if (r) {
      r.setZoom(r.zoomLevel() * factor);
    }
  }
}
