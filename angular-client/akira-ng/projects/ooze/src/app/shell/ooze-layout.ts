import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  signal,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
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
  protected readonly open = signal(this.initialOpen());

  protected toggle(): void {
    this.open.update(o => !o);
    this.remember();
  }

  protected close(): void {
    if (this.open()) {
      this.open.set(false);
      this.remember();
    }
  }

  private remember(): void {
    try {
      localStorage.setItem(OPEN_KEY, String(this.open()));
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
