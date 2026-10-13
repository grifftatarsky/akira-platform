import { JpssButton } from '../shared/button';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { StickerService } from './sticker.service';
import type { Sticker } from './sticker.models';
import { formatCoordinate } from './sticker.models';

/**
 * One sticker, opened: the photo, who put it there, when, what they said, and —
 * if it is yours — how to change or remove it.
 *
 * A sidebar rather than a floating card, because opening a sticker also drives
 * the camera down to the street it was taken on. The panel is the place you read
 * it; the map beside it is the place you are.
 *
 * Deleting asks first, inline. A native confirm would drop the photo out of view
 * at the exact moment somebody is deciding whether they meant it.
 */
/**
 * How wide and how tall the photo well is allowed to get, as width ÷ height.
 * 4:3 down to 4:5 — landscape enough to suit most cameras, portrait enough for a
 * phone held upright, without either extreme dictating the panel's shape.
 */
const WELL_WIDEST = 4 / 3;
const WELL_TALLEST = 4 / 5;

@Component({
  selector: 'jpss-sticker-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, JpssButton],
  host: { class: 'contents' },
  template: `
    <section class="flex min-h-0 flex-1 flex-col overflow-hidden" aria-labelledby="jpss-sidebar-title">
      <header class="flex items-start justify-between gap-2 border-b border-rule px-4 py-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-fg" id="jpss-sidebar-title">
            {{ sticker().authorName }}
          </p>
          <p class="truncate text-xs text-fg-subtle">
            {{ sticker().createdAt | date: 'mediumDate' }}
            @if (sticker().place) {
              <span aria-hidden="true"> · </span>{{ sticker().place }}
            }
          </p>
        </div>
        <button
          type="button"
          class="-mr-2 -mt-1 grid size-11 shrink-0 sm:-mr-1 sm:-mt-0.5 sm:size-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
          aria-label="Close sticker and return to the globe"
          (click)="dismiss.emit()">
          <svg viewBox="0 0 16 16" fill="currentColor" class="size-4 sm:size-3.5" aria-hidden="true">
            <path
              d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
          </svg>
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <!-- The thumbnail the globe never needed sits behind the full image,
             blurred, so the panel is never briefly empty on a slow connection.
             Aspect ratio comes from the stored dimensions, so nothing reflows
             when the photo lands.

             The w-full is not redundant with being a block. An aspect-ratio on
             a box whose width is auto lets the *height* cap drive the width
             back down to match the ratio, so a portrait photo under the 34dvh
             cap came out 221px wide in a 375px panel — a tall slab against a
             black gutter. A definite width means the cap only ever trims the
             height, and the object-cover below takes the crop, centred. -->
        <div
          class="relative w-full max-h-[34dvh] bg-bg-sunk bg-cover bg-center sm:max-h-[26rem]"
          [style.aspect-ratio]="aspectRatio()"
          [style.background-image]="placeholder()">
          <div class="absolute inset-0 backdrop-blur-xl"></div>
          <!-- The photo itself opens it, because that is what people try first;
               the button is the discoverable version of the same thing. -->
          <img
            class="absolute inset-0 size-full cursor-zoom-in object-cover transition-opacity duration-300"
            [class.opacity-0]="!loaded()"
            [src]="imageUrl()"
            [alt]="altText()"
            decoding="async"
            (load)="loaded.set(true)"
            (click)="viewPhoto.emit()" />
          <button
            type="button"
            class="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-bg/40 text-fg backdrop-blur-sm transition hover:bg-bg/70"
            aria-label="View photo full screen"
            (click)="viewPhoto.emit()">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="size-4"
              aria-hidden="true">
              <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" />
            </svg>
          </button>
        </div>

        <div class="px-4 py-4">
          @if (sticker().comment; as comment) {
            <p class="mb-3 text-sm leading-relaxed whitespace-pre-wrap text-fg">{{ comment }}</p>
          }
          <p class="font-mono text-[0.7rem] tabular-nums text-fg-subtle">{{ coordinates() }}</p>
        </div>
      </div>

      @if (owned()) {
        <div class="border-t border-rule px-4 py-3">
          @if (confirming()) {
            <p class="text-xs text-fg-muted">Delete this sticker for good?</p>
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                jpssButton="danger"
                [disabled]="busy()"
                (click)="confirmDelete()">
                {{ busy() ? 'Deleting…' : 'Delete' }}
              </button>
              <button
                type="button"
                jpssButton
                [disabled]="busy()"
                (click)="confirming.set(false)">
                Keep it
              </button>
            </div>
          } @else {
            <div class="flex gap-2">
              <button
                type="button"
                jpssButton
                (click)="edit.emit(sticker())">
                Edit
              </button>
              <button
                type="button"
                jpssButton="danger-quiet"
                (click)="confirming.set(true)">
                Delete
              </button>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class StickerSidebar {
  private readonly service = inject(StickerService);

  readonly sticker = input.required<Sticker>();

  readonly dismiss = output<void>();
  /**
   * Asked for rather than rendered here: the sidebar has a `backdrop-filter`,
   * which makes it a containing block for `position: fixed`, so a full-screen
   * overlay mounted inside it is sized to the sidebar instead of the viewport.
   */
  readonly viewPhoto = output<void>();
  readonly edit = output<Sticker>();
  readonly remove = output<Sticker>();

  protected readonly confirming = signal(false);
  protected readonly busy = signal(false);
  protected readonly loaded = signal(false);

  /** Drives the Edit and Delete row: your own stickers, or anyone's if you moderate. */
  protected readonly owned = computed(() => this.service.canEdit(this.sticker()));
  protected readonly imageUrl = computed(() => this.service.imageUrl(this.sticker()));
  protected readonly placeholder = computed(
    () => `url("${this.service.imageUrl(this.sticker(), 'thumb')}")`,
  );

  /**
   * The shape of the photo well, clamped rather than taken literally.
   *
   * <p>Using the photo's own ratio meant a panorama became a letterbox strip and
   * a tall portrait ran to the height cap, so the panel's proportions lurched
   * between stickers. Clamping to a band and letting `object-cover` take the
   * overflow fills the well every time, and only the extreme shapes lose
   * anything — a slight crop off the long edge, never a squeeze.
   */
  protected readonly aspectRatio = computed(() => {
    const { imageWidth, imageHeight } = this.sticker();
    if (imageWidth <= 0 || imageHeight <= 0) {
      return `${WELL_WIDEST}`;
    }
    const ratio = imageWidth / imageHeight;
    return `${Math.min(WELL_WIDEST, Math.max(WELL_TALLEST, ratio))}`;
  });

  protected readonly coordinates = computed(() => formatCoordinate(this.sticker()));

  /**
   * Screen readers get the caption when there is one and the place when there
   * is not — a photo with neither still needs to say whose it is, so the author
   * is always in there.
   */
  protected readonly altText = computed(() => {
    const { authorName, comment, place } = this.sticker();
    const about = comment ?? place;
    return about ? `Sticker by ${authorName}: ${about}` : `Sticker by ${authorName}`;
  });

  protected confirmDelete(): void {
    this.busy.set(true);
    this.remove.emit(this.sticker());
  }
}
