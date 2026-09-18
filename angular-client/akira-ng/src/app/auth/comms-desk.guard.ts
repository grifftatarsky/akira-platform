import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from './user.service';

/**
 * Gate for the abuse and contact desk.
 *
 * <p>Requires the {@code COMMS_DESK} realm role and not merely a session. Being
 * signed in to this realm is not a qualification to read what somebody was sent
 * — the same realm has accounts here for a card game. The service enforces it
 * too; this only keeps the page from drawing an empty shell and a 403.
 */
export const commsDeskGuard: CanActivateFn = () => {
  const userService = inject(UserService);
  const router = inject(Router);

  const user = userService.current;
  if (user.isAuthenticated && user.hasAuthority('COMMS_DESK')) {
    return true;
  }

  router.navigate(['/']);
  return false;
};
