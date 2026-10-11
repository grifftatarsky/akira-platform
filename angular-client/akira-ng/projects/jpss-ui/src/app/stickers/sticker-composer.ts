import { JpssButton } from '../shared/button';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { StickerService, describe } from './sticker.service';
import type { Coordinate, Sticker } from './sticker.models';
import { formatCoordinate } from './sticker.models';
import { readExifLocation } from './exif-location';

/** Matches jpss-resource's multipart cap, so an oversized photo fails here rather than at the proxy. */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_COMMENT = 500;
const MAX_PLACE = 80;

/**
 * Placing a sticker, and editing one you already placed.
 *
 * One component for both because the difference is small and entirely in what
 * the photo means: required and new when placing, optional and a replacement
 * when editing. Splitting them would duplicate the location picker, the caption
 * field and every piece of validation to save one conditional.
 *
 * The spot itself is not owned here — the parent holds it, because picking it
 * means clicking the globe, which this form is sitting next to rather than
 * inside.
 */
@Component({
  imports: [JpssButton],
  selector: 'jpss-sticker-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <form
      class="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden"
      (submit)="submit($event)">
      <!-- PICK BAR — the form's stand-in while the globe is waiting for a tap.
           On a phone this form is a sheet over 78% of the map, so leaving it up
           while somebody is trying to pick a spot covers the only thing they
           are looking at. Shown below the md breakpoint only; above it the form
           is a rail beside the map and never in the way, so nothing moves. -->
      @if (picking()) {
        <div class="flex items-center gap-3 px-3.5 py-2.5 md:hidden">
          <p class="min-w-0 flex-1 text-xs leading-snug text-fg-muted">
            @if (coordinate(); as spot) {
              <span class="block font-mono tabular-nums text-fg">{{ formatCoordinate(spot) }}</span>
              Tap the globe to move it.
            } @else {
              Tap the globe to place {{ editing() ? 'it' : 'your sticker' }}.
            }
          </p>
          <button
            type="button"
            jpssButton="primary"
            class="shrink-0"
            #donePicked
            (click)="donePicking.emit()">
            Done
          </button>
        </div>
      }

      <div [class]="bodyClass()">
      <header
        class="flex shrink-0 items-center justify-between gap-2 border-b border-rule px-3.5 py-2.5">
        <h2 class="text-sm font-semibold text-fg">
          {{ editing() ? 'Edit sticker' : 'New sticker' }}
        </h2>
        <button
          type="button"
          class="-mr-2 grid size-11 place-items-center rounded-md text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg sm:-mr-1 sm:size-7"
          aria-label="Close composer"
          (click)="cancel.emit()">
          <svg viewBox="0 0 16 16" fill="currentColor" class="size-4 sm:size-3.5" aria-hidden="true">
            <path
              d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
          </svg>
        </button>
      </header>

      <!-- The only scrolling region. Everything that can grow — the photo
           preview above all — lives in here, so the footer below stays put. -->
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div class="grid gap-3.5 px-3.5 py-3">
        <!-- PHOTO -->
        <div>
          <label class="text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-fg-subtle" [attr.for]="fileId">
            Photo{{ editing() ? ' (optional — replaces the current one)' : '' }}
          </label>
          <label
            [attr.for]="fileId"
            class="mt-1.5 grid cursor-pointer place-items-center rounded-lg border border-dashed border-rule-strong bg-bg-subtle px-3 py-4 text-center transition-colors hover:border-accent hover:bg-accent-subtle"
            [class.border-accent]="dragging()"
            [class.bg-accent-subtle]="dragging()"
            (dragover)="onDragOver($event)"
            (dragleave)="dragging.set(false)"
            (drop)="onDrop($event)">
            @if (previewUrl(); as preview) {
              <img
                class="max-h-36 w-auto rounded-md object-contain"
                [src]="preview"
                alt="Preview of the photo you selected" />
              <span class="mt-2 max-w-full truncate text-xs text-fg-muted">{{ fileName() }}</span>
              <span class="text-[0.7rem] text-fg-subtle">Click or drop to swap</span>
            } @else {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                   stroke-linecap="round" stroke-linejoin="round" class="size-6 text-fg-subtle" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span class="mt-2 text-sm font-medium text-fg">Choose a photo</span>
              <span class="text-[0.7rem] text-fg-subtle">or drop one here · JPEG, PNG, WebP, GIF · up to 8MB</span>
            }
          </label>
          <input
            type="file"
            class="sr-only"
            accept="image/jpeg,image/png,image/webp,image/gif"
            [attr.id]="fileId"
            (change)="onFileInput($event)" />
        </div>

        <!-- LOCATION -->
        <div>
          <span class="text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-fg-subtle">
            Location
          </span>
          @if (coordinate(); as spot) {
            <p class="mt-1 font-mono text-xs tabular-nums text-fg">
              {{ formatCoordinate(spot) }}
            </p>
          } @else {
            <p class="mt-1 text-xs text-fg-muted">Nowhere yet — pick a spot on the globe.</p>
          }
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-md border px-2.5 py-1.5 text-xs font-semibold transition"
              [class]="
                picking()
                  ? 'border-accent bg-accent-subtle text-accent'
                  : 'border-rule text-fg hover:bg-bg-subtle'
              "
              [attr.aria-pressed]="picking()"
              (click)="requestPick.emit()">
              {{ picking() ? 'Click the globe…' : coordinate() ? 'Move the pin' : 'Pick on map' }}
            </button>
            <button
              type="button"
              class="rounded-md border border-rule px-2.5 py-1.5 text-xs font-semibold text-fg transition hover:bg-bg-subtle disabled:opacity-60"
              [disabled]="locating()"
              (click)="useMyLocation()">
              {{ locating() ? 'Locating…' : 'Use my location' }}
            </button>
          </div>
        </div>

        <!-- PLACE -->
        <label class="block">
          <span class="text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-fg-subtle">
            Place <span class="font-normal normal-case tracking-normal">(optional)</span>
          </span>
          <input
            type="text"
            class="mt-1.5 w-full rounded-md border border-rule bg-bg-subtle px-2.5 py-1.5 text-base text-fg placeholder:text-fg-subtle sm:text-sm"
            placeholder="Prospect Park"
            [attr.maxlength]="maxPlace"
            [value]="place()"
            (input)="place.set(value($event))" />
        </label>

        <!-- COMMENT -->
        <label class="block">
          <span class="text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-fg-subtle">
            Comment
          </span>
          <textarea
            rows="3"
            class="mt-1.5 w-full resize-y rounded-md border border-rule bg-bg-subtle px-2.5 py-1.5 text-base text-fg placeholder:text-fg-subtle sm:text-sm"
            placeholder="What is this?"
            [attr.maxlength]="maxComment"
            [value]="comment()"
            (input)="comment.set(value($event))"></textarea>
          <span class="mt-1 block text-right text-[0.7rem] tabular-nums text-fg-subtle">
            {{ comment().length }}/{{ maxComment }}
          </span>
        </label>

        @if (error(); as message) {
          <p class="rounded-md border border-danger/40 bg-danger-subtle px-2.5 py-2 text-xs text-danger" role="alert">
            {{ message }}
          </p>
        }
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-2 border-t border-rule px-3.5 py-2.5">
        <button
          type="submit"
          jpssButton="primary"
          [disabled]="!canSubmit()">
          {{ busy() ? 'Saving…' : editing() ? 'Save changes' : 'Place sticker' }}
        </button>
        <button
          type="button"
          jpssButton
          [disabled]="busy()"
          (click)="cancel.emit()">
          Cancel
        </button>
      </div>
      </div>
    </form>
  `,
})
export class StickerComposer {
  private readonly service = inject(StickerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly donePicked = viewChild<ElementRef<HTMLButtonElement>>('donePicked');

  /** The sticker being edited, or null when placing a new one. */
  readonly editing = input<Sticker | null>(null);
  /** The spot the sticker will land on. Owned by the parent — the globe sets it. */
  readonly coordinate = input<Coordinate | null>(null);
  /** True while the globe is waiting for a click to set the spot. */
  readonly picking = input(false);

  readonly requestPick = output<void>();
  /** The phone pick bar's way back to the form; the parent clears `picking`. */
  readonly donePicking = output<void>();
  readonly locate = output<Coordinate>();
  /**
   * A coordinate found in the chosen photo's EXIF, or null when the photo
   * changed and the offer is stale.
   *
   * Raised rather than answered here: the dialog that asks about it is
   * `position: fixed`, and this form lives inside a panel with a
   * `backdrop-filter` — which makes that panel the containing block for fixed
   * descendants and clips them to it. The parent renders the dialog outside the
   * panel, the same reason the full-screen photo viewer is not a child of the
   * sidebar either.
   */
  readonly photoLocation = output<Coordinate | null>();
  readonly saved = output<Sticker>();
  readonly cancel = output<void>();

  protected readonly maxComment = MAX_COMMENT;
  protected readonly maxPlace = MAX_PLACE;
  protected readonly fileId = 'jpss-composer-photo';

  protected readonly comment = signal('');
  protected readonly place = signal('');
  protected readonly file = signal<File | null>(null);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly fileName = signal('');
  protected readonly dragging = signal(false);
  protected readonly locating = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * The form's own box, hidden on a phone while the globe is waiting for a tap
   * — the pick bar above takes its place.
   *
   * A class rather than an `@if`, so stepping aside does not tear down the form
   * and lose the photo and caption already in it. A media query rather than a
   * measured viewport, because the sheet it is reacting to is itself a media
   * query in jpss-page.css and two sources of truth would drift.
   */
  protected readonly bodyClass = computed(() =>
    this.picking()
      ? 'hidden min-h-0 flex-1 flex-col overflow-hidden md:flex'
      : 'flex min-h-0 flex-1 flex-col overflow-hidden',
  );

  protected readonly canSubmit = computed(() => {
    if (this.busy()) return false;
    if (!this.coordinate()) return false;
    // A new sticker needs a photo; an edit already has one.
    return this.editing() !== null || this.file() !== null;
  });

  constructor() {
    // Seeds the form when the parent swaps which sticker is being edited, and
    // clears it on the way back to "new".
    //
    // The body is untracked, and has to be. `setFile` reads `previewUrl` to
    // revoke the old object URL and then writes a new one — so a tracked body
    // would depend on a signal it also sets, and every photo the user chose
    // would re-run this effect and immediately clear itself. Only `editing()`
    // decides when the form is reseeded.
    effect(() => {
      const sticker = this.editing();
      untracked(() => {
        this.comment.set(sticker?.comment ?? '');
        this.place.set(sticker?.place ?? '');
        this.setFile(null);
        this.error.set(null);
      });
    });

    // Where the keyboard goes when the form steps aside. The button that
    // started pick mode is inside the part that just became display:none, so
    // without this focus falls back to the body and the sheet has nothing in
    // it that was ever focused. A no-op above the md breakpoint, where the
    // button below is itself display:none and the form never moved.
    afterRenderEffect(() => {
      if (this.picking()) this.donePicked()?.nativeElement.focus();
    });

    this.destroyRef.onDestroy(() => this.releasePreview());
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.accept(input.files?.[0] ?? null);
    // Cleared so re-choosing the same file still fires a change event.
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.accept(event.dataTransfer?.files?.[0] ?? null);
  }

  /** Client-side gate on type and size, so the obvious rejections are instant. */
  private accept(file: File | null): void {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.error.set('That needs to be an image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      this.error.set('That photo is over 8MB. Try a smaller one.');
      return;
    }
    this.error.set(null);
    this.setFile(file);
  }

  private setFile(file: File | null): void {
    this.releasePreview();
    this.file.set(file);
    this.fileName.set(file?.name ?? '');
    this.previewUrl.set(file ? URL.createObjectURL(file) : null);
    this.photoLocation.emit(null);
    if (file) void this.offerPhotoLocation(file);
  }

  /**
   * Offers the photo's own coordinate when it carries one.
   *
   * Asked rather than applied: the camera's idea of where a photo was taken is
   * usually what the user wants, but not always — a photo of somewhere is not
   * always a photo taken there — and silently moving a pin they had already
   * placed would be worse than not offering at all.
   *
   * The result is discarded if they swapped the photo again while this was
   * reading, so a slow parse cannot offer a location from a file that is no
   * longer attached.
   */
  private async offerPhotoLocation(file: File): Promise<void> {
    const found = await readExifLocation(file);
    if (found && this.file() === file) {
      this.photoLocation.emit(found);
    }
  }

  protected readonly formatCoordinate = formatCoordinate;

  /** Object URLs are held by the document until revoked; a long session would leak every preview. */
  private releasePreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
  }

  protected useMyLocation(): void {
    if (!navigator.geolocation) {
      this.error.set('This browser will not share a location.');
      return;
    }
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        this.locating.set(false);
        this.locate.emit({
          longitude: position.coords.longitude,
          latitude: position.coords.latitude,
        });
      },
      () => {
        this.locating.set(false);
        this.error.set('Could not read your location. Pick a spot on the globe instead.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const spot = this.coordinate();
    if (!this.canSubmit() || !spot) return;

    this.busy.set(true);
    this.error.set(null);
    const edit = {
      latitude: spot.latitude,
      longitude: spot.longitude,
      comment: this.comment().trim() || null,
      place: this.place().trim() || null,
    };

    try {
      const existing = this.editing();
      if (!existing) {
        this.saved.emit(await this.service.create(edit, this.file()!));
        return;
      }

      // Text and location first, then the photo if one was chosen — two calls
      // because the service splits them, and this order means a failed upload
      // leaves the caption fix already saved rather than losing both.
      let sticker = await this.service.edit(existing.id, edit);
      const replacement = this.file();
      if (replacement) {
        sticker = await this.service.replaceImage(existing.id, replacement);
      }
      this.saved.emit(sticker);
    } catch (error) {
      this.error.set(describe(error, 'That sticker could not be saved'));
    } finally {
      this.busy.set(false);
    }
  }
}
