import { ChangeDetectionStrategy, Component, DOCUMENT, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Thin standalone shell used only when ooze runs on its own (dev :4201).
 * In federation, the host loads ./routes directly — this App is never used.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<router-outlet />',
})
export class App {

  private readonly document = inject(DOCUMENT, { optional: true });

  constructor() {
    // <b>There is no header here, and a page that fills the viewport has to
    // know that.</b> Inside the host, ooze sits under a 3.5rem bar; served on
    // its own it starts at the top of the document. Anything sizing itself to
    // the visible area reads `--ooze-shell-header`, which defaults to the
    // host's bar — so the standalone shell is the one that has to say
    // otherwise. The globe does the same thing for the same reason.
    this.document?.documentElement?.style.setProperty('--ooze-shell-header', '0px');
  }
}
