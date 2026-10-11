import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
// maplibre-gl v6 is ESM-only — the UMD bundles are no longer published — and it
// has no default export. A namespace import is what the migration guide
// prescribes and the only form that works; `import maplibregl from` was correct
// under v5 for exactly the opposite reason, so do not "restore" it.
import * as maplibregl from 'maplibre-gl';

// v6 splits the tile-parsing worker out of the main bundle (v5's UMD inlined
// it). Left alone it resolves the worker from maplibre's own import.meta.url,
// which is wrong here: federation bundles maplibre into this remote's chunk, so
// there is no maplibre package directory to find it in — the worker silently
// never starts and the map requests no tiles at all, rendering a blank globe
// with no error. angular.json copies both worker files beside our chunks;
// import.meta.url points at one of those chunks, so this resolves correctly
// under the host (/remotes/jpss-ui/) and standalone (/) alike.
import type { Map as MapLibreMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
// Not @deck.gl/mapbox: its camera bridge reads `map.transform`, which v6
// removed. MapLibreOverlay is the supported replacement and takes camera state
// through the public API.
import { MapLibreOverlay } from '@deck.gl/maplibre';
import { MapView, _GlobeView as GlobeView } from '@deck.gl/core';
import type { Layer, View } from '@deck.gl/core';
import { ATTRIBUTION_LINKS, SKY, styleFor, styleIsRemote } from './basemap';
import { STICKER_PICK_LAYER } from './sticker-layers';
import {
  applyGroupVisibility,
  classifyLayers,
  defaultVisibility,
  emptyStyleGroups,
} from './layer-groups';
import type { GroupVisibility, LayerGroupId, StyleGroups } from './layer-groups';
import { REDUCED_MOTION } from './motion';
import { Defocus } from './defocus';
import { SpinController } from './spin-controller';

maplibregl.setWorkerUrl(new URL('maplibre-gl-worker.mjs', import.meta.url).href);

/**
 * Which projection *deck* draws in, by zoom. MapLibre is never told anything: it
 * stays on `'globe'` from load to teardown.
 *
 * That split is the whole point. MapLibre's `'globe'` is sugar for
 * `["interpolate",["linear"],["zoom"],11,"vertical-perspective",12,"mercator"]`,
 * and it blends the two per-frame in the shader. Left alone that is continuous
 * and invisible; calling `setProjection` to force one and then force it back
 * re-projects the world in a single step and reloads every tile manager.
 *
 * deck has to be steered because `getDefaultView()` reads `map.getProjection()`,
 * MapLibre answers `'globe'` at every zoom, and deck therefore pins itself to
 * GlobeView even above z12 where the map is already flat — where GlobeView loses
 * precision and marks drift off their coordinates. Handing deck a view under its
 * own MAPLIBRE_VIEW_ID decides it directly, and MapLibre never has to be lied to.
 *
 * So the crossover sits at the edges of MapLibre's own blend rather than in the
 * middle of it, and the two thresholds double as hysteresis: sitting inside the
 * band keeps whichever side the camera came from instead of flipping every frame.
 */
const TO_MERCATOR_ZOOM = 12;
const TO_GLOBE_ZOOM = 11;

/**
 * deck's own id for the view it syncs to the basemap camera. Supplying a view
 * under this id is what takes the projection choice away from deck's sniffing:
 * MapLibreOverlay uses `props.views` verbatim when given, but everything
 * downstream still looks the view up *by this id* — `deck.getView(id)` falls
 * back to sniffing the map's projection when it misses, and the per-frame
 * camera sync finds its viewport with `viewports.findIndex(v => v.id === id)`.
 *
 * The value is load-bearing and it changed with the overlay: @deck.gl/mapbox
 * used 'mapbox', @deck.gl/maplibre uses 'maplibre'. Getting it wrong does not
 * error — deck silently draws through a viewport we did not configure.
 */
const MAPLIBRE_VIEW_ID = 'maplibre';

type DeckView = 'globe' | 'mercator';

/** Hoisted so the identity is stable; a new View instance per render is churn deck has to diff. */
const VIEWS: Record<DeckView, View[]> = {
  globe: [new GlobeView({ id: MAPLIBRE_VIEW_ID })],
  mercator: [new MapView({ id: MAPLIBRE_VIEW_ID })],
};

/**
 * How far out the camera may pull back. MapLibre's default is 0, where the globe
 * is a small sphere in a large void — technically the whole earth, but it reads
 * as a bug rather than as a view. Raise it and the globe fills more of the frame
 * but the poles crop on a short viewport; lower it and the void comes back.
 */
/**
 * The zoom the globe rests at, and the floor the user can pull back to.
 *
 * Derived rather than picked. MapLibre's globe wraps the mercator world onto a
 * sphere, so at zoom z the sphere's circumference is the world width — 512·2^z
 * CSS px — and the disc it draws is that over pi. Inverting gives the zoom that
 * renders a globe of a wanted diameter, which is what lets a phone frame the
 * whole thing instead of cropping it: at the old flat 1.5 the disc is 461px
 * across, wider than any phone in portrait.
 *
 * Desktop is unchanged — `Math.min` keeps 1.5 wherever the viewport can already
 * hold the globe, so this only ever zooms *out*, and only as far as it must.
 */
function zoomForGlobeDiameter(px: number): number {
  return Math.log2((px * Math.PI) / 512);
}

/** Share of the shortest viewport edge the globe is allowed to fill. */
const GLOBE_FILL = 0.82;

const DESKTOP_MIN_ZOOM = 1.5;

function restingZoom(): number {
  if (typeof window === 'undefined') return DESKTOP_MIN_ZOOM;
  const shortest = Math.min(window.innerWidth, window.innerHeight);
  return Math.min(DESKTOP_MIN_ZOOM, zoomForGlobeDiameter(shortest * GLOBE_FILL));
}

/**
 * Cross-fades the whole GL container on first load and on every basemap swap,
 * both of which otherwise show the same unfinished paint: background, then
 * sources, then tiles arriving piecemeal.
 *
 * The sequence matters. The container fades out while still showing the *old*
 * style — complete and correct, just dimming — and the new style is applied only
 * once opacity has reached zero, so the entire teardown and repaint happens
 * off-screen. One CSS opacity transition, no framebuffer readback.
 */
const FADE_MS = REDUCED_MOTION ? 0 : 350;

/** Backstop so a style that never finishes loading cannot leave the map permanently invisible. */
const FADE_FAILSAFE_MS = 4000;

/** How long the camera takes to reach a sticker. */
const FLY_MS = REDUCED_MOTION ? 0 : 2200;

/**
 * The defocus is cleared by MapLibre's `idle` event — every tile in, nothing
 * animating. This is the backstop for the case where idle never comes: a source
 * that errors, or a camera move that starts before the last one settled. Longer
 * than the flight, so it only ever fires after the picture should already be up.
 */
const SETTLE_FAILSAFE_MS = FLY_MS + 900;

/**
 * Ceiling on the device pixel ratio deck renders at. `true` would follow the
 * device, which on a modern phone means 3.
 */
const DECK_MAX_PIXEL_RATIO =
  typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);

const INITIAL_VIEW = {
  center: [-30, 25] as [number, number],
  // Far enough out that the globe reads as a globe on first paint.
  zoom: 2.2,
  pitch: 0,
  bearing: 0,
};

/** A click on the globe, with whatever deck had under the cursor. */
export interface GlobeClick {
  readonly longitude: number;
  readonly latitude: number;
  /** The picked deck object, or null when the click landed on bare map. */
  readonly picked: unknown;
}

export type CameraTarget =
  | {
      readonly kind: 'center';
      readonly longitude: number;
      readonly latitude: number;
      readonly zoom: number;
      /**
       * Pixels to shift the target away from the centre of the map, for when
       * something is covering part of it — the sidebar. Without this, opening a
       * sticker flies it to the middle of the stage and then puts a panel on top
       * of it.
       */
      readonly offset?: [number, number];
    }
  /** [[west, south], [east, north]] — frames whatever a result actually contains. */
  | { readonly kind: 'bounds'; readonly bounds: [[number, number], [number, number]] };

/**
 * The globe: MapLibre in vertical-perspective projection, with the camera
 * behaviour ported from terminalGL — the cross-fade on every style swap, the
 * idle spin that stops the moment anyone reaches for the map, and the layer
 * groups the tools menu switches on and off.
 *
 * It draws the earth; deck.gl draws everything standing on it, through a
 * {@link MapLibreOverlay} that stays synced to this camera.
 *
 * {@link ViewEncapsulation.None} because MapLibre builds its own DOM inside the
 * container at runtime — canvas, controls, the lot — and Angular's emulated
 * encapsulation only stamps its attribute onto elements that came from a
 * template, so scoped rules would never reach any of it.
 */
@Component({
  selector: 'jpss-globe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './globe.css',
  template: `
    <div class="jpss-globe">
      <div
        class="jpss-globe__canvas"
        [class.jpss-globe__canvas--hidden]="!ready()"
        [class.jpss-globe__canvas--defocus-deep]="settlePhase() === 'deep'"
        [class.jpss-globe__canvas--defocus-cruise]="settlePhase() === 'cruise'"
        [style.transition-duration.ms]="fadeMs"
        #container></div>

      <!-- ODbL requires the credit; nothing requires it to shout. -->
      <p class="jpss-globe__attribution">
        @for (link of attribution; track link.href; let first = $first) {
          @if (!first) {<span aria-hidden="true"> · </span>}
          <a [href]="link.href" target="_blank" rel="noreferrer">{{ link.label }}</a>
        }
      </p>

      <ng-content />
    </div>
  `,
})
export class Globe {
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly destroyRef = inject(DestroyRef);

  /** deck layers to draw over the basemap. */
  readonly layers = input<Layer[]>([]);
  readonly basemap = input.required<string>();
  readonly visibility = input<GroupVisibility>(defaultVisibility());
  /** Pulls back to the whole earth and rotates until cleared, or until the map is touched. */
  readonly spinning = input(false);
  /** Swapped to a crosshair while the composer is waiting for a spot. */
  readonly picking = input(false);
  /**
   * Releases the map entirely while another view is on top.
   *
   * A hidden WebGL canvas is not a free one: MapLibre keeps rendering, the spin
   * keeps requesting tiles, and the context holds GPU memory for a globe nobody
   * is looking at. `map.remove()` is the only thing that actually gives that
   * back, so suspending tears down and resuming rebuilds. The component itself
   * stays mounted because the overlays — menu bar included — are projected
   * through it.
   */
  readonly suspended = input(false);

  readonly globeClick = output<GlobeClick>();
  /** Fired when the spin ends on its own — somebody grabbed the map — so the menu can follow. */
  readonly spinStop = output<void>();
  readonly groupSizes = output<Partial<Record<LayerGroupId, number>>>();
  /** True from the moment a style starts loading until its fade-in has finished. */
  readonly loadingChange = output<boolean>();

  protected readonly attribution = ATTRIBUTION_LINKS;
  protected readonly fadeMs = FADE_MS;
  protected readonly ready = signal(false);
  private readonly defocus = new Defocus(SETTLE_FAILSAFE_MS);
  /** How far through resolving a camera flight is; drives the defocus classes. */
  protected readonly settlePhase = this.defocus.phase;

  private map?: MapLibreMap;
  /** afterNextRender has run, so the container exists and create() is safe. */
  private built = false;
  private overlay?: MapLibreOverlay;
  private spin?: SpinController;
  /** Which projection deck is drawing in. A signal so the layer effect follows it. */
  private readonly deckView = signal<DeckView>('globe');
  private groups: StyleGroups = emptyStyleGroups();
  /** The basemap whose per-style setup has already been applied. */
  private patched: string | null = null;
  /** A map has been built once, so a later one is a resume rather than an entrance. */
  private opened = false;
  /** The style actually handed to MapLibre — lags the input across a fade. */
  private readonly applied = signal<string | null>(null);

  private fadeTimer = 0;
  private failsafeTimer = 0;
  private loadingTimer = 0;

  constructor() {
    afterNextRender(() => {
      this.built = true;
      if (!this.suspended()) this.create();
    });

    effect(() => {
      const suspended = this.suspended();
      if (!this.built) return;
      if (suspended && this.map) {
        this.teardown();
        this.map = undefined;
        this.ready.set(false);
      } else if (!suspended && !this.map) {
        this.create();
      }
    });

    // Deferring the style swap until the container has finished fading out is
    // the whole trick; changing it while visible is what makes a rebuild ugly.
    effect(() => {
      const wanted = this.basemap();
      const current = this.applied();
      if (current === null || current === wanted) return;

      this.ready.set(false);
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = window.setTimeout(() => this.applyStyle(wanted), FADE_MS);
    });

    // Layers and the projection travel together: both are deck props, and the
    // view has to be read here so a crossover re-runs this rather than waiting
    // for the next layer change.
    effect(() => {
      const layers = this.layers();
      const view = this.deckView();
      this.overlay?.setProps({ layers, views: VIEWS[view] } as never);
    });

    effect(() => {
      const visibility = this.visibility();
      const map = this.map;
      // `patched` is set exactly when a style has been classified, so it is also
      // the test for "there are layer ids to apply this to".
      if (!map || this.patched === null) return;
      applyGroupVisibility(map, this.groups, visibility);
    });

    effect(() => {
      if (this.spinning()) this.spin?.start(restingZoom());
      else this.spin?.stop();
    });

    effect(() => {
      const cursor = this.picking() ? 'crosshair' : 'grab';
      this.map?.getCanvas().style.setProperty('cursor', cursor);
    });

    // Held until the fade-in has actually finished rather than dropped the
    // moment the style reports ready — otherwise the indicator vanishes while
    // the map is still visibly arriving.
    effect(() => {
      window.clearTimeout(this.loadingTimer);
      if (!this.ready()) {
        this.loadingChange.emit(true);
        return;
      }
      this.loadingTimer = window.setTimeout(() => this.loadingChange.emit(false), FADE_MS);
    });

    this.destroyRef.onDestroy(() => this.teardown());
  }

  /** Eases the camera to a point. A long ease reads as the globe turning under you. */
  flyTo(target: CameraTarget): void {
    const map = this.map;
    if (!map) return;

    this.defocus.begin();

    if (target.kind === 'center') {
      map.flyTo({
        center: [target.longitude, target.latitude],
        zoom: target.zoom,
        offset: target.offset ?? [0, 0],
        duration: FLY_MS,
        essential: true,
      });
      return;
    }
    // maxZoom matters for the degenerate case: a single sticker has a zero-area
    // box, and fitBounds would otherwise slam the camera to full zoom on a dot.
    map.fitBounds(target.bounds, {
      padding: 90,
      maxZoom: 12,
      duration: FLY_MS,
      essential: true,
    });
  }

  /** Where the camera is now, for callers that want to fly in without pulling back out. */
  zoom(): number {
    return this.map?.getZoom() ?? 0;
  }

  /**
   * Defocuses the basemap for the duration of a camera flight, so the detail
   * that streams in at the far end resolves into focus instead of popping in
   * tile by tile. Only the MapLibre canvas is blurred: deck draws to its own
   * canvas under `interleaved: false`, so the sticker marks stay sharp
   * throughout and the effect reads as the ground coming into focus behind
   * them rather than as the whole view going soft.
   *
   * Cleared by `idle` — MapLibre fires it once every tile for the current
   * camera is in and nothing is animating, which is precisely the moment the
   * picture is worth looking at. `flyTo` is only ever called to zoom *in*;
   * the pull-back is driven by the spin, whose per-frame `jumpTo` would keep
   * the map from ever going idle.
   */
  private readonly onIdle = (): void => this.defocus.noteIdle();

  // region map lifecycle

  private create(): void {
    const basemap = this.basemap();
    // Only the first map of the session gets the opening shot, and only if the
    // settle is going to run at all — see the `zoom` note below.
    const intro = !this.opened && this.spinning();
    this.opened = true;
    const map = new maplibregl.Map({
      container: this.container().nativeElement,
      style: styleFor(basemap),
      center: INITIAL_VIEW.center,
      // The wide opening shot is an intro, and an intro plays once. It only
      // reads as one because the settle animation immediately pulls it back to
      // the resting zoom — so without that animation it is not a flourish, it
      // is just the globe being too close. Two ways that happened: coming back
      // from the gallery after opening a sticker, which turns spin off, and
      // reduced-motion, where it never starts. Both landed on a globe wound in
      // to 2.2 with nothing left to pull it out.
      zoom: intro ? INITIAL_VIEW.zoom : restingZoom(),
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
      // The globe interpolates itself into Mercator around z11-12, so one camera
      // covers whole-earth to street level with no mode switch.
      minZoom: restingZoom(),
      maxZoom: 20,
      // Supplied below, outside the map, so its placement is not at the mercy of
      // MapLibre's corner stacking.
      attributionControl: false,
      // Cache size is this times the tiles in the viewport (default 5). When a
      // tile is missing MapLibre scales up its parent to cover the gap, so the
      // cache is what stands between a fast camera and a hole in the map — and
      // this camera makes an unusually large excursion: opening a sticker flies
      // to z16 and dismissing pulls back to about z1, far enough that the
      // low-zoom parents have long since been evicted at the default. Costs
      // memory in proportion, which is why it is 10 and not 30.
      maxTileCacheZoomLevels: 10,
    });
    this.map = map;
    this.applied.set(basemap);

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    // Overlaid, not interleaved, and not configurable. MapLibreOverlay reads
    // `interleaved` in its constructor only, so flipping it later leaves deck
    // holding GPU buffers created against a context it no longer draws into.
    // Overlaid also means a basemap style swap cannot delete deck's layers.
    this.overlay = new MapLibreOverlay({
      interleaved: false,
      // Must be layers built for *this* Deck: a descriptor cannot outlive the
      // Deck it was handed to. The shell rebuilds them whenever the globe
      // suspends, which is what makes that true — see `layers` in JpssPage.
      layers: this.layers(),
      views: VIEWS.globe,
      // Phones report a device pixel ratio of 3, which is 2.25x the fragments of
      // 2 for marks that are flat colour over a 256px glyph — no visible gain,
      // and it is the single biggest lever on a mobile GPU. MapLibre keeps its
      // own ratio for the basemap, where the extra density does show in labels.
      useDevicePixels: DECK_MAX_PIXEL_RATIO,
    } as never);
    map.addControl(this.overlay);

    map.on('styledata', this.onStyleData);
    map.on('idle', this.onIdle);
    // v6 made `styleimagemissing` notify-only: a listener can observe the miss
    // but not answer it. This is the supported way to supply the image, and it
    // is a setter rather than a subscription, so there is nothing to unbind.
    map.setMissingStyleImageResolver(this.onMissingImage);
    map.on('move', this.onMove);
    map.on('click', this.onClick);
    map.on('error', this.onError);

    this.spin = new SpinController(map, this.onReachForMap);
    this.armFailsafe();
    this.onStyleData();
    if (this.spinning()) this.spin.start(restingZoom());
  }

  private teardown(): void {
    this.spin?.stop();
    this.spin = undefined;
    this.defocus.end();
    window.clearTimeout(this.fadeTimer);
    window.clearTimeout(this.failsafeTimer);
    window.clearTimeout(this.loadingTimer);

    const map = this.map;
    if (!map) return;
    map.off('styledata', this.onStyleData);
    map.off('idle', this.onIdle);
    map.off('move', this.onMove);
    map.off('click', this.onClick);
    map.off('error', this.onError);
    // Releases the WebGL context along with everything deck built against it.
    map.remove();
    this.map = undefined;
    this.overlay = undefined;

    // Everything below describes the map that just died, and a resumed globe
    // builds a new one. Leaving `patched` set was a real bug: onStyleData's
    // guard saw the basemap as already patched, skipped setProjection, and the
    // globe came back as flat Mercator. The classified layer ids belong to the
    // old style object too, and the deck view has to start from the projection
    // the fresh camera actually opens at.
    this.patched = null;
    this.groups = emptyStyleGroups();
    this.deckView.set('globe');
    this.ready.set(false);
  }

  private applyStyle(basemap: string): void {
    // Forces the per-style setup below to run again for the new style.
    this.patched = null;
    this.groups = emptyStyleGroups();
    this.applied.set(basemap);
    this.armFailsafe();
    this.map?.setStyle(styleFor(basemap) as StyleSpecification | string);
  }

  /** Re-armed per style, so a style that never reports ready cannot leave a black pane. */
  private armFailsafe(): void {
    window.clearTimeout(this.failsafeTimer);
    this.failsafeTimer = window.setTimeout(() => this.ready.set(true), FADE_FAILSAFE_MS);
  }

  // endregion

  // region map events

  /**
   * Everything per-style is re-run here because swapping the basemap replaces
   * the whole style, discarding the projection, the sky and the visibility
   * overrides with it. The `patched` guard is what keeps it to once per style:
   * MapLibre fires styledata on essentially every tile and source update, and
   * each of these calls mutates the style, which fires styledata again.
   */
  private readonly onStyleData = (): void => {
    const map = this.map;
    if (!map) return;

    // Cheap guard first, and it is the one that matters for cost: MapLibre fires
    // styledata on essentially every tile and source update, and this returns
    // for all but the handful of events between a style being requested and it
    // being parsed.
    const basemap = this.applied();
    if (basemap === null || this.patched === basemap) return;

    // `getStyle()` returns undefined until the style JSON has been parsed and
    // its layers built — which is precisely "has the new style arrived".
    //
    // Not `isStyleLoaded()`, which additionally waits for every source to finish
    // loading tiles. That is a different question, and one that has no answer
    // while the globe is turning: the spin requests new tiles every frame, so
    // the map is never quiet and this whole block would never run.
    const style = map.getStyle();
    if (!style) return;
    this.patched = basemap;

    if (styleIsRemote(basemap)) {
      // A style fetched from a URL says nothing about projection or sky; both
      // are imposed once it lands. The comparison is not a micro-optimisation:
      // setProjection reloads every tile manager, so setting it unconditionally
      // throws away the tiles that just arrived.
      if (map.getProjection()?.type !== 'globe') {
        map.setProjection({ type: 'globe' });
      }
      map.setSky(SKY);
    }

    // The one serialize per style. Everything downstream works from the
    // classified ids, so a pan never touches the style again.
    this.groups = classifyLayers(style.layers);
    applyGroupVisibility(map, this.groups, this.visibility());
    this.groupSizes.emit(this.groups.sizes);

    // Reported after the reapplication above: fading in on a style that still
    // has the wrong projection would just animate the wrong picture into view.
    this.ready.set(true);
  };

  /**
   * OpenFreeMap's dark and fiord styles ask for hyphenated sprite icons
   * (`circle-11`) while their sprite ships the underscored names (`circle_11`) —
   * an upstream mismatch that logs once per missing icon. Aliasing resolves it
   * from the sprite already in memory; a transparent pixel is the fallback so an
   * unknown name stops warning instead of repeating.
   */
  private readonly onMissingImage = (id: string): void => {
    const map = this.map;
    if (!map || map.hasImage(id)) return;

    const aliased = id.replace(/-/g, '_');
    if (aliased !== id && map.hasImage(aliased)) {
      // getImage returns metadata plus an RGBAImage under `data`; addImage wants
      // the raw pixels, and the sprite's pixelRatio and sdf flag have to travel
      // with them — an SDF icon re-registered as a plain one renders as a black box.
      const source = map.getImage(aliased);
      if (source?.data) {
        map.addImage(id, source.data, { pixelRatio: source.pixelRatio, sdf: source.sdf });
        return;
      }
    }
    map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  };

  private readonly onMove = (): void => {
    const zoom = this.map?.getZoom();
    if (zoom === undefined) return;

    const current = this.deckView();
    const next: DeckView =
      current === 'globe' && zoom >= TO_MERCATOR_ZOOM
        ? 'mercator'
        : current === 'mercator' && zoom < TO_GLOBE_ZOOM
          ? 'globe'
          : current;

    // A deck viewport swap, not a MapLibre projection migration, so it is cheap
    // enough to belong on the gesture rather than deferred to its end.
    if (next !== current) this.deckView.set(next);
  };

  /**
   * One click path for both jobs a click can mean, and the ordering is decided
   * here rather than inferred.
   *
   * Picking explicitly instead of through a layer's own `onClick`: the overlay
   * forwards the map's click into deck as well, so a layer callback and this
   * handler would both fire for a click on a sticker, and whichever ran second
   * would have to guess whether the other had already claimed it.
   */
  private readonly onClick = (event: MapMouseEvent): void => {
    const info = this.overlay?.pickObject({
      x: event.point.x,
      y: event.point.y,
      // A finger is not a pixel.
      radius: 8,
      layerIds: [STICKER_PICK_LAYER],
    });
    this.globeClick.emit({
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
      picked: info?.object ?? null,
    });
  };

  /**
   * MapLibre reports a failed style, sprite, glyph or tile here. Unhandled, it
   * logs to the console and the failsafe eventually reveals a blank map with no
   * explanation — which on a keyless public tile service with no SLA is a
   * plausible Tuesday. Revealing immediately is strictly better than four more
   * seconds of black: a half-drawn map at least says what failed.
   */
  private readonly onError = (event: { error?: { message?: string } }): void => {
    console.warn('[jpss basemap]', event.error?.message ?? 'map error', event.error);
    this.ready.set(true);
  };

  // endregion

  // region spin

  private readonly onReachForMap = (): void => {
    if (this.spinning()) this.spinStop.emit();
  };

  // endregion
}

