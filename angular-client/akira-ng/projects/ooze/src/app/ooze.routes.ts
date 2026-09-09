import { Routes } from '@angular/router';
import { OozeLayout } from './shell/ooze-layout';
import { OozeDashboard } from './dashboard/ooze-dashboard';

/**
 * Routes exposed as the federation remote (see federation.config.mjs) and also
 * used by the standalone app. Every view renders inside {@link OozeLayout} so
 * the collapsible dice panel is present across all of ooze. New DM tool routes
 * hang off the layout's children.
 */
export const OOZE_ROUTES: Routes = [
  {
    path: '',
    component: OozeLayout,
    children: [
      { path: '', component: OozeDashboard, data: { title: 'Oozengine' } },
      {
        // A board with nothing behind it, so the renderer can be looked at
        // without a database, a Keycloak or a signed-in DM.
        path: 'board',
        loadComponent: () => import('./board/board-demo').then(m => m.BoardDemo),
        data: { title: 'Board preview' },
      },
      {
        // Lazy, and deliberately so: three is ~130 KB gzipped and the finder
        // has no use for it, so the compendium should not pay for a renderer
        // nobody has opened.
        path: 'board/:encounterId',
        loadComponent: () => import('./board/board-page').then(m => m.BoardPage),
        data: { title: 'Board' },
      },
    ],
  },
];
