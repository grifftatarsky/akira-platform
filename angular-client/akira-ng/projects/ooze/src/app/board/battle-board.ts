import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed,
  effect, input, output, signal, viewChild,
} from '@angular/core';
import { Battle, BoardScene, Encounter } from './board.models';
import { BoardRenderer, CameraMode } from './board-renderer';
import { BoardTheme, KAYKIT_THEME } from './board-assets';
import { PointerStart, dropAt, gestureFor, pathBetween, zoomAfterWheel } from './board-gestures';
import { cellSize, sceneForBattle, sceneForEncounter } from './board-scene';

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

        <div class="pointer-events-auto flex items-center gap-1">
          <button type="button" (click)="recentre()"
                  class="rounded-md border border-rule bg-bg/85 px-2 py-1 text-[0.7rem]
                         text-fg-muted backdrop-blur transition hover:text-fg">Centre</button>
          <button type="button" (click)="toggleCamera()"
                  class="rounded-md border border-rule bg-bg/85 px-2 py-1 text-[0.7rem]
                         text-fg-muted backdrop-blur transition hover:text-fg">
            {{ cameraMode() === 'TOP_DOWN' ? 'Top-down' : 'Perspective' }}
          </button>
          <button type="button" (click)="zoomBy(0.8)" aria-label="Zoom in"
                  class="rounded-md border border-rule bg-bg/85 px-2 py-1 text-[0.7rem]
                         text-fg-muted backdrop-blur transition hover:text-fg">+</button>
          <button type="button" (click)="zoomBy(1.25)" aria-label="Zoom out"
                  class="rounded-md border border-rule bg-bg/85 px-2 py-1 text-[0.7rem]
                         text-fg-muted backdrop-blur transition hover:text-fg">−</button>
        </div>
      </div>

      @if (!scene()) {
        <p class="absolute inset-0 grid place-items-center text-xs text-fg-subtle">
          Nothing placed yet.
        </p>
      }

      @if (selectedName(); as name) {
        <p class="pointer-events-none absolute bottom-2 left-2 rounded-md border border-rule
                  bg-bg/85 px-2 py-1 text-[0.7rem] text-fg backdrop-blur">{{ name }}</p>
      }

      <p class="pointer-events-none absolute bottom-2 right-2 rounded-md border border-rule
                bg-bg/85 px-2 py-1 text-[0.65rem] text-fg-subtle backdrop-blur">
        Drag a token to move · drag the board to pan · hold Alt to place freely
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
   * the board caring. A theme with no models draws coloured tiles, which is what
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

    const board = this.scene();
    if (board) {
      this.renderer.render(board);
      // Frame the whole board on first sight, so a 300-foot battlefield does
      // not open showing one square of floor.
      this.renderer.setZoom(Math.max(board.widthHalfFeet, board.heightHalfFeet) * 1.1);
    }
    this.renderer.start();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    // Geometries and materials hold device buffers that nothing collects for
    // us; a board rebuilt on every state change would leak until the context is
    // lost, which reads as "the tab got slow" hours later.
    this.renderer?.dispose();
    this.renderer = null;
  }

  protected toggleCamera(): void {
    const next: CameraMode = this.cameraMode() === 'TOP_DOWN' ? 'PERSPECTIVE' : 'TOP_DOWN';
    this.cameraMode.set(next);
    this.renderer?.setCameraMode(next);
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
    if (!start || !renderer) {
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
