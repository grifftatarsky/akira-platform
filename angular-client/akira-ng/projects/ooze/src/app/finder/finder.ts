import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, distinctUntilChanged, map, of, switchMap, timer } from 'rxjs';
import { RouterLink } from '@angular/router';
import { ShellAuthService } from '../shell/shell-auth.service';
import { CONTENT_TYPES, CatalogItem, ContentTypeDef } from './ooze-content.models';
import { CatalogPage, ContentService } from './content.service';
import { ContentPanel } from './content-panel';
import { FinderMenuBar } from './finder-menu-bar';

/** What a list request is made of: the folder, and the two filters over it. */
interface ListRequest {
  readonly def: ContentTypeDef | null;
  readonly query: string;
  readonly includeLegacy: boolean;
  /** Bumped to re-run the same request after a save. */
  readonly tick: number;
}

interface ItemGroup {
  readonly key: string | number;
  readonly label: string;
  readonly order: number;
  readonly items: CatalogItem[];
}

/**
 * Finder-style browser for catalog content, driven entirely by the
 * {@link ContentTypeDef}s: a menu bar, a grid of content "folders", and — once a
 * folder is opened — a list beside a detail/edit pane. Editing affordances show
 * only for a signed-in DM. Unimplemented folders are disabled with a hint.
 */
@Component({
  selector: 'ooze-finder',
  imports: [FinderMenuBar, ContentPanel, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './finder.html',
  styleUrl: './finder.css',
})
export class Finder {
  private readonly content = inject(ContentService);
  private readonly shellAuth = inject(ShellAuthService);

  protected readonly folders = CONTENT_TYPES;
  protected readonly openDef = signal<ContentTypeDef | null>(null);

  /**
   * The rows loaded so far — page 0 plus whatever "Load more" has appended.
   * Not the whole folder: searching and the edition toggle are the server's
   * job now, so this only ever holds what has actually been shown.
   */
  protected readonly all = signal<readonly CatalogItem[]>([]);
  protected readonly total = signal(0);
  private readonly pageNumber = signal(0);
  protected readonly loading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly loadError = signal(false);
  protected readonly search = signal('');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly creating = signal(false);

  /** Editions this folder draws on; the toggle only appears if 5.1 is one. */
  private readonly editions = signal<readonly string[]>([]);

  /** Bumped by a save, to re-run the current request. */
  private readonly reloadTick = signal(0);

  /** Reselected once the reload that a save triggered comes back. */
  private pendingSelect: string | null = null;

  protected readonly hasMore = computed(() => this.all().length < this.total());

  private readonly user = toSignal(this.shellAuth.user$);
  /** Editing is gated on the DUNGEON_MASTER role; everyone else is read-only. */
  protected readonly canEdit = computed(() =>
    (this.user()?.roles ?? []).includes('DUNGEON_MASTER'),
  );
  protected readonly isAuthenticated = computed(() => this.user()?.isAuthenticated ?? false);

  /** mailto for logged-in users without the DM role to request access. */
  protected readonly requestAccessHref =
    'mailto:grifftatarsky@gmail.com' +
    '?subject=' +
    encodeURIComponent('Oozengine — Dungeon Master access request') +
    '&body=' +
    encodeURIComponent("Hey! I'm requesting access for Dungeon Master tools on Oozengine. Thanks!");

  /**
   * Whether to include SRD 5.1 rows. On by default — the 5.1 content we carry
   * is only what 5.2 has no equivalent of, so hiding it by default would hide
   * the reason it was imported. Remembered per browser; a blocked or empty
   * localStorage just means the default.
   */
  protected readonly showLegacy = signal(Finder.readShowLegacy());

  /** True once the open folder actually holds 5.1 rows — the toggle is hidden
   * otherwise rather than offering to filter a distinction that isn't there. */
  protected readonly hasLegacy = computed(() => this.editions().includes('SRD_5_1'));

  protected readonly groups = computed<ItemGroup[]>(() => {
    const def = this.openDef();
    const list = this.all();
    if (!def?.group) {
      return list.length ? [{ key: '_', label: '', order: 0, items: [...list] }] : [];
    }
    const map = new Map<string | number, ItemGroup>();
    for (const it of list) {
      const g = def.group(it);
      const existing = map.get(g.key);
      if (existing) existing.items.push(it);
      else map.set(g.key, { key: g.key, label: g.label, order: g.order, items: [it] });
    }
    return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  });

  /**
   * The open entry, in full. List rows can be summaries, so the detail is
   * fetched on selection and cached per id — reopening one is free, and the
   * list payload stays small however big the catalog gets.
   */
  private readonly detailCache = signal<Record<string, CatalogItem>>({});

  protected readonly selected = computed(() => {
    const id = this.selectedId();
    if (!id) return null;
    return this.detailCache()[id] ?? this.all().find(i => i.id === id) ?? null;
  });

  /** On mobile the detail is a bottom sheet shown only when something's open. */
  protected readonly detailOpen = computed(() => this.selected() !== null || this.creating());

  // Swipe-to-dismiss state for the mobile bottom sheet.
  protected readonly dragY = signal(0);
  protected readonly dragging = signal(false);
  protected readonly sheetTransform = computed(() => `translateY(${this.dragY()}px)`);
  private dragStartY = 0;

  /**
   * Opening a folder, typing in the search box and flipping the edition toggle
   * are all the same thing — a request for page 0 — so they are one stream
   * rather than three call sites that have to remember to reset the page.
   */
  private readonly request = computed<ListRequest>(() => ({
    def: this.openDef(),
    query: this.search().trim(),
    includeLegacy: this.showLegacy(),
    tick: this.reloadTick(),
  }));

  constructor() {
    toObservable(this.request)
      .pipe(
        distinctUntilChanged(
          (a, b) =>
            a.def === b.def &&
            a.query === b.query &&
            a.includeLegacy === b.includeLegacy &&
            a.tick === b.tick,
        ),
        // Typing debounces. Opening a folder or flipping the toggle doesn't:
        // switchMap cancels the pending timer, which is the debounce, and an
        // empty query skips it so the folder opens the moment it's clicked.
        switchMap(r => (r.query ? timer(220).pipe(map(() => r)) : of(r))),
        switchMap(r => {
          if (!r.def) return EMPTY;
          this.loading.set(true);
          this.loadError.set(false);
          return this.content
            .list(r.def.apiPath, { page: 0, query: r.query, includeLegacy: r.includeLegacy })
            .pipe(catchError(() => this.failed()));
        }),
        takeUntilDestroyed(),
      )
      .subscribe(page => this.replace(page));
  }

  protected open(def: ContentTypeDef): void {
    if (!def.implemented) return;
    this.openDef.set(def);
    this.search.set('');
    this.creating.set(false);
    this.all.set([]);
    this.editions.set([]);
    // The stream that fills it runs on the next tick; without this the list
    // flashes "Nothing here yet." on the way to the first page.
    this.loading.set(true);
    this.content.editions(def.apiPath).subscribe({
      next: e => this.editions.set(e),
      // Only decides whether an optional toggle is offered; not worth an error.
      error: () => this.editions.set([]),
    });
  }

  /** Appends the next page. The list keeps what it has — this is "more", not
   * "instead", and the selected row must survive it. */
  protected loadMore(): void {
    const def = this.openDef();
    if (!def || this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    this.content
      .list(def.apiPath, {
        page: this.pageNumber() + 1,
        query: this.search().trim(),
        includeLegacy: this.showLegacy(),
      })
      .subscribe({
        next: page => {
          this.all.update(rows => [...rows, ...page.content]);
          this.total.set(page.page.totalElements);
          this.pageNumber.set(page.page.number);
          this.loadingMore.set(false);
        },
        error: () => this.loadingMore.set(false),
      });
  }

  private replace(page: CatalogPage): void {
    this.all.set(page.content);
    this.total.set(page.page.totalElements);
    this.pageNumber.set(page.page.number);
    this.detailCache.set({});
    this.loading.set(false);

    const reselect =
      this.pendingSelect && page.content.some(i => i.id === this.pendingSelect)
        ? this.pendingSelect
        : null;
    this.pendingSelect = null;
    this.selectedId.set(reselect);
    if (reselect) this.loadDetail(reselect);
  }

  private failed() {
    this.loading.set(false);
    this.loadError.set(true);
    return EMPTY;
  }

  protected back(): void {
    this.openDef.set(null);
    this.selectedId.set(null);
    this.creating.set(false);
    this.all.set([]);
    this.total.set(0);
  }

  protected select(i: CatalogItem): void {
    this.creating.set(false);
    this.selectedId.set(i.id);
    this.loadDetail(i.id);
  }

  private loadDetail(id: string): void {
    const def = this.openDef();
    if (!def || this.detailCache()[id]) return;
    this.content.get(def.apiPath, id).subscribe({
      next: full => this.detailCache.update(c => ({ ...c, [id]: full })),
      // The summary from the list is already showing; a failed detail fetch
      // leaves it in place rather than blanking the pane.
      error: () => undefined,
    });
  }

  protected startCreate(): void {
    this.selectedId.set(null);
    this.creating.set(true);
  }

  protected onChanged(id: string | null): void {
    this.creating.set(false);
    this.pendingSelect = id;
    this.reloadTick.update(t => t + 1);
  }

  protected onCloseCreate(): void {
    this.creating.set(false);
  }

  /** Close the mobile bottom sheet (back to the list). */
  protected closeDetail(): void {
    this.selectedId.set(null);
    this.creating.set(false);
    this.dragY.set(0);
    this.dragging.set(false);
  }

  protected onDragStart(event: TouchEvent): void {
    this.dragStartY = event.touches[0]?.clientY ?? 0;
    this.dragging.set(true);
  }

  protected onDragMove(event: TouchEvent): void {
    const y = event.touches[0]?.clientY ?? this.dragStartY;
    this.dragY.set(Math.max(0, y - this.dragStartY));
  }

  protected onDragEnd(): void {
    this.dragging.set(false);
    if (this.dragY() > 120) {
      this.closeDetail();
    } else {
      this.dragY.set(0);
    }
  }

  protected subtitle(i: CatalogItem): string {
    const d = this.openDef();
    return d?.subtitle ? d.subtitle(i) : '';
  }

  protected dotClass(i: CatalogItem): string {
    return i.overridesId ? 'bg-warn' : 'bg-success';
  }

  protected toggleLegacy(): void {
    const next = !this.showLegacy();
    this.showLegacy.set(next);
    // Deselecting matters: hiding 5.1 while a 5.1 row is open would otherwise
    // leave the detail pane showing something the list no longer offers.
    if (!next && this.selected()?.srdVersion === 'SRD_5_1') this.selectedId.set(null);
    try {
      localStorage.setItem(Finder.LEGACY_KEY, next ? 'on' : 'off');
    } catch {
      // Private windows and blocked site data throw on write; the toggle still
      // works for this session, it just won't be remembered.
    }
  }

  private static readonly LEGACY_KEY = 'ooze.showLegacySrd';

  private static readShowLegacy(): boolean {
    try {
      return localStorage.getItem(Finder.LEGACY_KEY) !== 'off';
    } catch {
      return true;
    }
  }
}
