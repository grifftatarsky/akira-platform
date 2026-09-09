import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed,
  effect, input, signal, viewChild,
} from '@angular/core';
import { Battle, BoardScene, Encounter } from './board.models';
import { BoardRenderer, CameraMode } from './board-renderer';
import { sceneForBattle, sceneForEncounter } from './board-scene';

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
  template: `
    <div class="relative h-full w-full overflow-hidden rounded-lg border border-rule bg-bg-subtle">
      <canvas #canvas class="block h-full w-full"></canvas>

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
    </div>
  `,
})
export class BattleBoard implements AfterViewInit, OnDestroy {

  readonly encounter = input<Encounter | null>(null);
  readonly battle = input<Battle | null>(null);

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private renderer: BoardRenderer | null = null;
  private observer: ResizeObserver | null = null;

  protected readonly cameraMode = signal<CameraMode>('TOP_DOWN');

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
      if (board && this.renderer) {
        this.renderer.render(board);
      }
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    this.renderer = new BoardRenderer(canvas);
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

  protected zoomBy(factor: number): void {
    const r = this.renderer;
    if (r) {
      r.setZoom(r.zoomLevel() * factor);
    }
  }
}
