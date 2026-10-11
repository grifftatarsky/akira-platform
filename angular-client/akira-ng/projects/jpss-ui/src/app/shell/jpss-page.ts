import { stickerLabel } from '../stickers/sticker.models';
import { PhotoViewer } from '../stickers/photo-viewer';
import { GalleryView } from '../stickers/gallery-view';
import { RequestStickersPrompt } from '../stickers/request-stickers-prompt';
import { PhotoLocationPrompt } from '../stickers/photo-location-prompt';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Globe } from '../map/globe';
import type { GlobeClick } from '../map/globe';
import { DEFAULT_BASEMAP, basemapTone } from '../map/basemap';
import { defaultVisibility } from '../map/layer-groups';
import type { GroupVisibility, LayerGroupId } from '../map/layer-groups';
import { REDUCED_MOTION } from '../map/motion';
import { stickerLayers } from '../map/sticker-layers';
import { StickerSidebar } from '../stickers/sticker-sidebar';
import { StickerComposer } from '../stickers/sticker-composer';
import { StickerService, describe } from '../stickers/sticker.service';
import type { Coordinate, Sticker } from '../stickers/sticker.models';
import { MenuBar } from './menu-bar';

/**
 * Where the camera lands when a sticker is opened — close enough to read the
 * street it was taken on, which is the whole reason opening one moves the map.
 */
const STREET_ZOOM = 16;

/** Zoom used when the composer is aimed somewhere; near enough to place precisely. */
const PLACE_ZOOM = 9;

/** Width of the sidebar on desktop, matched to jpss-page.css. */
const SIDEBAR_WIDTH = 380;

/** Below this the sidebar is a bottom sheet, so the camera offset goes vertical. */
const SIDEBAR_BREAKPOINT = 768;

/** How much of the stage the bottom sheet may cover — `max-height` in jpss-page.css. */
const SHEET_MAX_FRACTION = 0.78;

interface Toast {
  readonly tone: 'info' | 'error';
  readonly message: string;
}

/**
 * The whole application: a globe with stickers on it, one menu, and a sidebar.
 *
 * Nothing here navigates. Opening a sticker flies the camera down to it and
 * slides the sidebar in; dismissing it hands the camera back to the spin, which
 * pulls out to the whole earth on its own. Routing away would throw away the
 * camera, and the camera is where you were.
 */
@Component({
  selector: 'jpss-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Globe,
    MenuBar,
    StickerSidebar,
    StickerComposer,
    PhotoViewer,
    PhotoLocationPrompt,
    GalleryView,
    RequestStickersPrompt,
  ],
  templateUrl: './jpss-page.html',
  styleUrl: './jpss-page.css',
})
export class JpssPage {
  protected readonly label = stickerLabel;
  /** The sticker whose photo is open full screen, if any. */
  protected readonly viewingPhoto = signal<Sticker | null>(null);
  /** Which way the wall is being read. The globe releases its WebGL context in 'gallery'. */
  protected readonly view = signal<'globe' | 'gallery'>('globe');
  protected readonly requestingStickers = signal(false);

  protected readonly stickers = inject(StickerService);
  private readonly globe = viewChild.required(Globe);
  /** The map's own box, which is what the camera offsets below are measured in. */
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  // region map state

  protected readonly basemap = signal(DEFAULT_BASEMAP);
  protected readonly visibility = signal<GroupVisibility>(defaultVisibility());
  protected readonly groupSizes = signal<Partial<Record<LayerGroupId, number>>>({});
  protected readonly mapLoading = signal(true);
  /**
   * Turning on arrival, because the first thing this app has to say is "there is
   * a globe and there are stickers on it" — and it stops the moment anyone
   * reaches for the map. Off from the start when the viewer asked for less motion.
   */
  protected readonly spinning = signal(!REDUCED_MOTION);

  // endregion

  // region wall state

  protected readonly selectedId = signal<string | null>(null);
  protected readonly hoveredId = signal<string | null>(null);
  /** Null when closed; a sticker when editing; 'new' when placing. */
  protected readonly composer = signal<Sticker | 'new' | null>(null);
  /** Where the composer's sticker will land. Held here because the globe sets it. */
  protected readonly pending = signal<Coordinate | null>(null);
  protected readonly picking = signal(false);
  /** The EXIF offer from the composer's current photo; the dialog is rendered here. */
  protected readonly photoLocation = signal<Coordinate | null>(null);
  protected readonly toast = signal<Toast | null>(null);

  private toastTimer = 0;

  // endregion

  protected readonly count = computed(() => this.stickers.stickers().length);
  protected readonly username = computed(() => this.stickers.currentUser()?.username ?? null);
  protected readonly composing = computed(() => this.composer() !== null);
  protected readonly editing = computed(() => {
    const open = this.composer();
    return open === null || open === 'new' ? null : open;
  });

  protected readonly selected = computed(() => {
    const id = this.selectedId();
    return id === null ? null : (this.stickers.stickers().find(s => s.id === id) ?? null);
  });

  protected readonly hovered = computed(() => {
    const id = this.hoveredId();
    return id === null ? null : (this.stickers.stickers().find(s => s.id === id) ?? null);
  });

  /** Whether the sidebar column is showing anything, so the stage can shift for it. */
  protected readonly sidebarOpen = computed(() => this.composing() || this.selected() !== null);

  private readonly ownedIds = computed(() => new Set(this.stickers.mine().map(s => s.id)));

  /**
   * The globe releases its WebGL context while the gallery is up, so this is
   * also "the deck instance is about to be thrown away and rebuilt". Bound to
   * the globe *and* read by `layers` below, deliberately from one expression:
   * the two have to agree, and deriving them separately is how they drift.
   */
  protected readonly globeSuspended = computed(() => this.view() === 'gallery');

  /**
   * Deliberately does not read `hoveredId`. Hover is a GPU tint via deck's
   * `autoHighlight`; reading it here would make every pointer move across the
   * globe rebuild all three layers. `hoveredId` still drives the label below,
   * which is DOM and cheap.
   *
   * It does read `globeSuspended`, which is otherwise nothing to do with what a
   * layer looks like. A deck Layer is a descriptor, but not an inert one: once
   * handed over, deck initialises it against the live WebGL context and
   * resolves its async props in place — `atlas` stops being our canvas and
   * becomes an uploaded texture. Suspending for the gallery destroys that
   * context, so a memoized array would come back holding layers deck refuses to
   * initialise ("assertion failed", no marks at all) carrying textures from a
   * context that no longer exists (marks as black squares). Both were real.
   * Reading it here means a resumed globe always gets descriptors built for the
   * deck instance it is actually about to create.
   */
  protected readonly layers = computed(() => {
    this.globeSuspended();
    return stickerLayers({
      stickers: this.stickers.stickers(),
      selectedId: this.selectedId(),
      ownedIds: this.ownedIds(),
      tone: basemapTone(this.basemap()),
      // Only while the composer is actually waiting for one — a leftover marker
      // on a closed form is a spot nobody picked.
      pending: this.composing() ? this.pending() : null,
      onHover: sticker => this.hoveredId.set(sticker?.id ?? null),
    });
  });

  constructor() {
    void this.stickers.load();
    void this.stickers.loadMe();

    // A signed-out user has nothing to compose with. Covers the session expiring
    // under an open form as well as the sign-out button.
    effect(() => {
      if (!this.stickers.signedIn() && this.stickers.authChecked() && this.composing()) {
        this.closeComposer();
      }
    });
  }

  // region map

  protected toggleSpin(): void {
    this.spinning.update(spinning => !spinning);
  }

  protected toggleGroup(group: LayerGroupId): void {
    this.visibility.update(current => ({ ...current, [group]: !current[group] }));
  }

  /**
   * One handler for everything a click on the globe can mean.
   *
   * Placing a spot wins while the composer is waiting for one, even when the
   * click lands on an existing sticker — the crosshair has already promised
   * that, and stickers cluster exactly where people want to add more.
   */
  protected onGlobeClick(event: GlobeClick): void {
    if (this.picking()) {
      this.pending.set({ longitude: event.longitude, latitude: event.latitude });
      // Pick mode ends on the click only while the form is standing beside the
      // map and can show the result. On a phone it is not: the form has stepped
      // aside for a pick bar so the globe is reachable at all, and dropping out
      // of pick mode would slide the sheet back over the pin to say where the
      // pin is. Staying in it means a spot can be nudged across several taps,
      // and the bar's Done button is the way back.
      if (!this.sheetMode()) this.picking.set(false);
      return;
    }

    const sticker = event.picked as Sticker | null;
    if (sticker) {
      this.open(sticker);
      return;
    }
    // A click on bare map with a sticker open means "put it away" — so the
    // camera comes back out and the globe starts turning again.
    if (this.selected()) this.dismiss();
  }

  /** Opens a sticker: sidebar in, spin off, camera down to the street. */
  protected open(sticker: Sticker): void {
    this.spinning.set(false);
    this.selectedId.set(sticker.id);
    this.globe().flyTo({
      kind: 'center',
      longitude: sticker.longitude,
      latitude: sticker.latitude,
      zoom: STREET_ZOOM,
      offset: this.sidebarOffset(),
    });
  }

  /**
   * Picking a sticker in the gallery goes back to the globe and opens it there,
   * so "where is this" is answered by the view that can answer it.
   */
  /**
   * What a saved photo is called. Named after where it was taken and when, so a
   * folder of these is still readable a year later — an id would not be. Falls
   * back to the author when there is no place label, and strips anything a file
   * system might object to.
   */
  protected downloadName(sticker: Sticker): string {
    const extension = sticker.imageContentType === 'image/png' ? 'png' : 'jpg';
    const slug =
      (sticker.place ?? sticker.authorName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'sticker';
    return `jo-${slug}-${sticker.createdAt.slice(0, 10)}.${extension}`;
  }

  protected openFromGallery(sticker: Sticker): void {
    this.view.set('globe');
    this.open(sticker);
  }

  /**
   * Closes the sidebar and hands the camera back to the spin, which eases out to
   * the whole earth by itself — the same pull-back it does on arrival, so
   * leaving a sticker and landing on the page look like the same motion.
   */
  protected dismiss(): void {
    this.selectedId.set(null);
    this.spinning.set(true);
  }

  /**
   * The gallery's Globe button. Turning is the globe's idle state, so coming
   * back to it should turn.
   *
   * It dismisses too, and that is not scope creep: the resumed globe opens at
   * the resting zoom rather than wherever the camera was, so a sticker selected
   * before the detour is already stale by the time we get here. Leaving it
   * highlighted under an open sidebar would caption a view nobody is looking at.
   */
  protected leaveGallery(): void {
    this.view.set('globe');
    this.dismiss();
  }

  /** Whether the sidebar is a bottom sheet rather than a rail — the `md` breakpoint. */
  private sheetMode(): boolean {
    return typeof window !== 'undefined' && window.innerWidth < SIDEBAR_BREAKPOINT;
  }

  /**
   * Keeps the point the camera flies to inside the part of the stage the sidebar
   * is not covering.
   *
   * MapLibre reads `offset` as where the target lands *relative to the centre of
   * the map*, so clearing a bottom sheet means moving up by more than half the
   * stage, not by a token amount. A flat −18% of the window put the target at
   * 32% of the height, under a sheet whose top edge is at 22% — so every
   * sticker opened on a phone flew to a pin hidden behind the panel describing
   * it. Aiming at the middle of the band above the sheet cannot land under it.
   *
   * It uses the sheet's `max-height` rather than the panel's measured height
   * because the first flight is dispatched before the panel has rendered; the
   * cap is the safe assumption, since a shorter sheet only leaves more room.
   */
  private sidebarOffset(): [number, number] {
    if (!this.sheetMode()) return [-SIDEBAR_WIDTH / 2, 0];
    const height = this.stage().nativeElement.clientHeight;
    const free = height * (1 - SHEET_MAX_FRACTION);
    return [0, Math.round(free / 2 - height / 2)];
  }

  // endregion

  // region composer

  protected startNew(): void {
    this.spinning.set(false);
    this.selectedId.set(null);
    this.pending.set(null);
    this.composer.set('new');
    // Straight into pick mode: a new sticker needs a spot before anything else
    // about it matters, and this saves the extra click on "Pick on map".
    this.picking.set(true);
  }

  protected startEdit(sticker: Sticker): void {
    this.composer.set(sticker);
    this.pending.set({ longitude: sticker.longitude, latitude: sticker.latitude });
    this.picking.set(false);
  }

  protected closeComposer(): void {
    this.composer.set(null);
    this.pending.set(null);
    this.picking.set(false);
    this.photoLocation.set(null);
  }

  /**
   * The phone pick bar's Done: back to the form, with the spot kept in frame.
   *
   * Lands the same way "Use my location" and the EXIF offer do, so all three
   * ways of setting a spot end with the camera holding it above the sheet. It
   * has to fly in rather than just shift the view, because the offset that
   * clears the sheet is only expressible once the globe is larger than the
   * screen: at the resting zoom the whole earth is a 308px disc, and no
   * rotation puts a point on it 317px above its own centre. MapLibre answers
   * that by slamming the camera at the pole, which is what it did here.
   *
   * The zoom only ever goes in, so somebody who zoomed to street level to put
   * the pin on the right building keeps the view they picked it in.
   */
  protected finishPicking(): void {
    const spot = this.pending();
    if (!spot) {
      this.picking.set(false);
      return;
    }
    this.onLocate(spot, Math.max(this.globe().zoom(), PLACE_ZOOM));
  }

  protected onLocate(spot: Coordinate, zoom = PLACE_ZOOM): void {
    this.pending.set(spot);
    this.picking.set(false);
    this.globe().flyTo({ kind: 'center', ...spot, zoom, offset: this.sidebarOffset() });
  }

  protected acceptPhotoLocation(spot: Coordinate): void {
    this.photoLocation.set(null);
    this.onLocate(spot);
  }

  protected onSaved(sticker: Sticker): void {
    const wasNew = this.composer() === 'new';
    this.closeComposer();
    this.open(sticker);
    this.notify('info', wasNew ? 'Sticker placed.' : 'Sticker updated.');
  }

  protected async onRemove(sticker: Sticker): Promise<void> {
    try {
      await this.stickers.remove(sticker.id);
      this.dismiss();
      this.notify('info', 'Sticker deleted.');
    } catch (error) {
      this.notify('error', describe(error, 'That sticker could not be deleted'));
    }
  }

  // endregion

  // region session

  protected async signIn(): Promise<void> {
    try {
      await this.stickers.login();
    } catch (error) {
      this.notify('error', describe(error, 'Sign-in is unavailable right now'));
    }
  }

  protected async signOut(): Promise<void> {
    this.closeComposer();
    try {
      await this.stickers.logout();
    } catch (error) {
      this.notify('error', describe(error, 'Sign-out did not complete'));
    }
  }

  // endregion

  private notify(tone: Toast['tone'], message: string): void {
    window.clearTimeout(this.toastTimer);
    this.toast.set({ tone, message });
    // Errors stay put; a confirmation has said its piece after a few seconds.
    if (tone === 'info') {
      this.toastTimer = window.setTimeout(() => this.toast.set(null), 4000);
    }
  }
}
