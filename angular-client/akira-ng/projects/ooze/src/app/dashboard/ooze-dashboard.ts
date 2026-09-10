import {
  ChangeDetectionStrategy,
  Component,
  inject,
  isDevMode,
} from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ShellAuthService } from '../shell/shell-auth.service';
import { Finder } from '../finder/finder';

@Component({
  selector: 'ooze-dashboard',
  imports: [AsyncPipe, Finder, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ooze-dashboard.html',
})
export class OozeDashboard {
  private readonly shellAuth = inject(ShellAuthService);

  /**
   * The route this remote is mounted on. Every link below is relative to it.
   *
   * <p>Standalone, ooze is at `/`; inside akira it is at `/ooze`. An absolute
   * link is right in exactly one of those.
   */
  protected readonly root = inject(ActivatedRoute).parent;

  /** Shared Keycloak user, streamed from the shell when federated. */
  protected readonly user$ = this.shellAuth.user$;

  /**
   * Dev-only federation call-out. `isDevMode()` is false in a production build,
   * so it's stripped from the built site.
   */
  protected readonly showFederationBadge = isDevMode();
}
