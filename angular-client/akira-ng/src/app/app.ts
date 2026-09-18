import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  Signal,
  computed,
  effect,
  inject,
  signal,
  WritableSignal,
} from '@angular/core';
import { DOCUMENT, NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { Auth } from './auth/auth';
import { UserService } from './auth/user.service';
import { filter, map, Observable } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { User } from './auth/user.model';
import { ToastContainerComponent } from './common/notification/toast-container.component';
import { NotificationBellComponent } from './common/notification/notification-bell.component';
import { SystemStatusService } from './common/system-status.service';
import { GITHUB_URL } from './app.constants';

type DownKey = 'ooze' | 'president' | 'jpss';

type NavLink = Readonly<{
  label: string;
  href: string;
  ariaLabel?: string;
  /** When set, the link renders an "unavailable" state while the matching
   *  federated service is reported down by {@link SystemStatusService}. */
  downKey?: DownKey;
}>;

type NavGroup = Readonly<{
  label: string;
  ariaLabel?: string;
  children: readonly NavLink[];
}>;

type ThemePreference = 'system' | 'light' | 'dark';

/** Must track `--color-bg` in styles.css and the metas in index.html. */
const THEME_COLOUR = { light: '#ffffff', dark: '#0a0a0b' } as const;

@Component({
  selector: 'app-root',
  imports: [
    NgOptimizedImage,
    RouterLink,
    RouterOutlet,
    Auth,
    ToastContainerComponent,
    NotificationBellComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  // region DI

  private readonly userService: UserService = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);
  // Drives the "temporarily unavailable" state on the Oozengine nav link.
  protected readonly systemStatus = inject(SystemStatusService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly titleService = inject(Title);
  private readonly mediaQuery: MediaQueryList | null =
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  private readonly handleSystemPreferenceChange = (event: MediaQueryListEvent): void => {
    this.systemPrefersDark.set(event.matches);
  };

  // endregion

  private readonly systemPrefersDark = signal(false);
  protected readonly themePreference = signal<ThemePreference>('system');
  protected readonly themeOptions: readonly { label: string; value: ThemePreference }[] = [
    { label: 'System', value: 'system' },
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ];

  readonly isAuthenticated$: Observable<boolean>;

  constructor() {
    this.isAuthenticated$ = this.userService.valueChanges.pipe(
      map((user: User): boolean => user.isAuthenticated),
    );
    this.initializeTheme();
    effect(() => {
      this.applyTheme(this.themePreference(), this.systemPrefersDark());
    });
    this.wireRouteTitles();
  }

  /**
   * Walks the activated route tree on every NavigationEnd and sets
   * `document.title` from the deepest route with a `data.title` entry.
   * All titles are suffixed with " · Akira".
   */
  private wireRouteTitles(): void {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.closeGamesMenu(); // any navigation dismisses the dropdown
        let route = this.activatedRoute;
        while (route.firstChild) {
          route = route.firstChild;
        }
        const title = route.snapshot.data['title'] as string | undefined;
        this.titleService.setTitle(title ? `${title} · Akira` : 'Akira');
      });
  }

  protected setThemePreference(preference: ThemePreference): void {
    if (this.themePreference() === preference) {
      return;
    }
    this.themePreference.set(preference);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('akira-theme', preference);
    }
  }

  private initializeTheme(): void {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('akira-theme');
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        this.themePreference.set(stored);
      }
    }
    if (this.mediaQuery) {
      this.systemPrefersDark.set(this.mediaQuery.matches);
      this.mediaQuery.addEventListener('change', this.handleSystemPreferenceChange);
      this.destroyRef.onDestroy(() => {
        this.mediaQuery?.removeEventListener('change', this.handleSystemPreferenceChange);
      });
    }
    this.applyTheme(this.themePreference(), this.systemPrefersDark());
  }

  private applyTheme(preference: ThemePreference, systemPrefersDark: boolean): void {
    const root = this.document?.documentElement;
    if (!root) {
      return;
    }
    const useDarkTheme = preference === 'dark' || (preference === 'system' && systemPrefersDark);
    root.classList.toggle('dark', useDarkTheme);
    this.applyBrowserChromeColour(useDarkTheme);
  }

  /**
   * iOS Safari (and Chrome on Android) tint the browser chrome — the status bar
   * behind the notch or Dynamic Island, and the bottom toolbar — from
   * `<meta name="theme-color">`. The two tags in index.html carry
   * `media="(prefers-color-scheme: ...)"` so the chrome is already right on the
   * first paint, before this runs. But a media query cannot see a *manual*
   * theme choice, so once the preference resolves we write the same colour into
   * both tags: whichever one Safari matches then yields the same answer.
   */
  private applyBrowserChromeColour(useDarkTheme: boolean): void {
    const colour = useDarkTheme ? THEME_COLOUR.dark : THEME_COLOUR.light;
    const tags = this.document?.head?.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    tags?.forEach((tag) => tag.setAttribute('content', colour));
  }

  // region Mobile Menu

  private readonly baseNavLinks: readonly NavLink[] = [
    { label: 'Docs', href: '/docs' },
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Shelves', href: '/shelves' },
    { label: 'Elections', href: '/elections' },
    { label: 'Activity', href: '/activity' },
    { label: 'Blog', href: '/blog' },
  ];

  /**
   * The abuse desk, shown only to the one account that can open it.
   *
   * Everyone else would get a link that 403s, and a link into somebody else's
   * abuse reports is not a thing to advertise to a realm full of card players.
   */
  private readonly user: Signal<User | undefined> = toSignal(this.userService.valueChanges);

  protected readonly navLinks: Signal<readonly NavLink[]> = computed(() =>
    this.user()?.hasAuthority('COMMS_DESK')
      ? [...this.baseNavLinks, { label: 'Desk', href: '/desk' }]
      : this.baseNavLinks,
  );

  /** Federated micro-frontends, grouped under one desktop dropdown. */
  protected readonly gamesMenu: NavGroup = {
    label: 'Apps',
    ariaLabel: 'Federated apps and tools',
    children: [
      { label: 'Oozengine', href: '/ooze', ariaLabel: 'Oozengine DM tools (federated)', downKey: 'ooze' },
      { label: 'President 🃏', href: '/games/president', ariaLabel: 'President card game (federated)', downKey: 'president' },
      { label: 'Jo Peace Stickers 🌍', href: '/stickers', ariaLabel: 'Jo Peace Sticker Service — photos on a globe (federated)', downKey: 'jpss' },
    ],
  };

  protected readonly githubUrl = GITHUB_URL;

  /** Whether a federated nav entry's service is currently reported down. */
  protected isDown(link: NavLink): boolean {
    if (link.downKey === 'ooze') {
      return this.systemStatus.oozeDown();
    }
    if (link.downKey === 'president') {
      return this.systemStatus.presidentDown();
    }
    if (link.downKey === 'jpss') {
      return this.systemStatus.jpssDown();
    }
    return false;
  }
  protected readonly mobileMenuOpen: WritableSignal<boolean> = signal(false);
  protected readonly mobileMenuId: string = 'mobile-nav-panel';

  protected toggleMobileMenu(): void {
    this.mobileMenuOpen.update((isOpen: boolean): boolean => !isOpen);
  }

  protected closeMobileMenu(): void {
    if (this.mobileMenuOpen()) {
      this.mobileMenuOpen.set(false);
    }
  }

  /** Desktop "Games" dropdown — controlled so it closes on click/nav/Escape. */
  protected readonly gamesOpen: WritableSignal<boolean> = signal(false);

  protected toggleGamesMenu(): void {
    this.gamesOpen.update((isOpen: boolean): boolean => !isOpen);
  }

  protected openGamesMenu(): void {
    this.gamesOpen.set(true);
  }

  protected closeGamesMenu(): void {
    if (this.gamesOpen()) {
      this.gamesOpen.set(false);
    }
  }

  @HostListener('window:keydown.escape')
  protected handleEscape(): void {
    this.closeMobileMenu();
    this.closeGamesMenu();
  }

  // endregion
}
