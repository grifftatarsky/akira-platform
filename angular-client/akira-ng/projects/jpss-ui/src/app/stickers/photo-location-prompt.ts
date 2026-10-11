import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { JpssButton } from '../shared/button';
import { formatCoordinate, type Coordinate } from './sticker.models';

/**
 * Asks whether to place the sticker where its photo was taken.
 *
 * Asked rather than applied: the camera's idea of where a photo was taken is
 * usually what the user wants, but not always — a photo *of* somewhere is not
 * always a photo taken there — and silently moving a pin they had already
 * placed would be worse than not offering at all.
 *
 * Its own component so the composer is not also a dialog — and mounted by the
 * page, not by the composer. `position: fixed` is not enough on its own here:
 * the sidebar the composer lives in has a `backdrop-filter`, which makes it the
 * containing block for fixed descendants, so inside it this sized itself to the
 * panel and the panel's `overflow: hidden` clipped the rest. On a phone that is
 * a modal rendered inside the bottom sheet it is trying to cover.
 */
@Component({
  selector: 'jpss-photo-location-prompt',
  imports: [JpssButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        class="absolute inset-0 cursor-default bg-[#10111480] dark:bg-[#0405079e] backdrop-blur-sm"
        aria-label="Keep the current location"
        (click)="dismiss.emit()"></button>
      <section
        class="relative z-10 w-full max-w-md rounded-lg border border-rule bg-bg p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jpss-photo-location-title">
        <h2 id="jpss-photo-location-title" class="text-base font-semibold text-fg">
          This photo remembers where it was taken
        </h2>
        <p class="mt-1.5 text-sm leading-relaxed text-fg-muted">
          Place the sticker there instead of picking a spot on the globe?
        </p>
        <p class="mt-2.5 font-mono text-xs tabular-nums text-fg-subtle">
          {{ formatted() }}
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" jpssButton="primary" (click)="accept.emit(spot())">
            Use that spot
          </button>
          <button type="button" jpssButton (click)="dismiss.emit()">No, I will pick</button>
        </div>
        <p class="mt-3 text-[0.7rem] leading-relaxed text-fg-subtle">
          The location is only read here — the copy that gets uploaded has its metadata
          stripped either way.
        </p>
      </section>
    </div>
  `,
})
export class PhotoLocationPrompt {
  readonly spot = input.required<Coordinate>();

  readonly accept = output<Coordinate>();
  readonly dismiss = output<void>();

  protected formatted(): string {
    return formatCoordinate(this.spot());
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void {
    this.dismiss.emit();
  }
}
