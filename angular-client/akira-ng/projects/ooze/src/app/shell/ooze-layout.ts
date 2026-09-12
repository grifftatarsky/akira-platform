import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { DiceRoller } from '../dice/dice-roller';

/** Where this browser's choice about the dice panel is kept. */
const OPEN_KEY = 'ooze.dice.open';

@Component({
  selector: 'ooze-layout',
  imports: [RouterOutlet, DiceRoller],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ooze-layout.html',
  styleUrl: './ooze-layout.css',
})
export class OozeLayout {
  protected readonly panelId = 'ooze-dice-panel';
  private readonly router = inject(Router);

  /**
   * Whether the routed page has asked for the whole viewport.
   *
   * <p>Declared on the route rather than inferred from the path, so a page
   * saying "I am a map" is a fact about that page and not a list of URLs kept
   * in the shell. The dice rail is always-visible chrome and a board is the one
   * kind of page where always-visible chrome is wrong: it takes a strip off the
   * right of the thing the page exists to show.
   */
  private readonly full = toSignal(this.router.events.pipe(
    filter(event => event instanceof NavigationEnd),
    startWith(null),
    map(() => {
      // <b>Walk the snapshot tree, not the live one.</b> Read during the
      // component's own construction — which `startWith` makes happen — a
      // child `ActivatedRoute` exists before its snapshot does, and reading
      // `.data` off it throws before the page has drawn anything.
      let deepest = this.router.routerState.snapshot.root;
      while (deepest.firstChild) {
        deepest = deepest.firstChild;
      }
      return deepest.data['full'] === true;
    }),
  ), { initialValue: false });

  protected readonly bare = computed(() => this.full());
  private readonly wanted = signal(this.initialOpen());
  protected readonly open = computed(() => this.wanted() && !this.full());

  protected toggle(): void {
    this.wanted.update(o => !o);
    this.remember();
  }

  protected close(): void {
    if (this.wanted()) {
      this.wanted.set(false);
      this.remember();
    }
  }

  private remember(): void {
    try {
      localStorage.setItem(OPEN_KEY, String(this.wanted()));
    } catch {
      // A browser that refuses storage simply gets the default every time,
      // which is the same behaviour this had before it remembered anything.
    }
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void {
    this.close();
  }

  /**
   * Closed unless this browser was left with it open.
   *
   * <p>It used to open itself on every desktop-width page, which is a
   * reasonable default for a dice page and an intrusion everywhere else — it
   * takes a fifth of the width off a board for a tool nobody asked for yet.
   *
   * <p>Remembered rather than merely defaulted, so a DM who does want it open
   * is not closing it once per navigation. Wrapped, because storage throws
   * outright in a private window rather than returning nothing.
   */
  private initialOpen(): boolean {
    try {
      return localStorage.getItem(OPEN_KEY) === 'true';
    } catch {
      return false;
    }
  }
}
