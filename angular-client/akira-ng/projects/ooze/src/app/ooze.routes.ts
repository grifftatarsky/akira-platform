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
        // The way in to a real board. Not lazy — it is a list and a form, and
        // making it lazy would put a chunk load between a DM and the screen
        // they reach for most.
        path: 'encounters',
        loadComponent: () =>
          import('./encounters/encounter-list').then(m => m.EncounterList),
        data: { title: 'Encounters' },
      },
      {
        // The Babylon port. Same level data, same ground field, same sun.
        path: 'board/bab',
        loadComponent: () => import('./board/bab/bab-board').then(m => m.BabBoard),
        data: { title: 'The road, on Babylon' },
      },
      {
        // Before the `:encounterId` route below, or that one swallows it —
        // Angular matches routes in the order they are declared.
        path: 'board/coast',
        loadComponent: () => import('./board/coast-demo').then(m => m.CoastDemo),
        data: { title: 'The Broken Light' },
      },
      {
        path: 'board/wood',
        loadComponent: () => import('./board/wood-demo').then(m => m.WoodDemo),
        data: { title: 'The cabin' },
      },
      {
        path: 'board/pass',
        loadComponent: () => import('./board/pass-demo').then(m => m.PassDemo),
        data: { title: 'The pass' },
      },
      {
        path: 'board/road',
        loadComponent: () => import('./board/road-demo').then(m => m.RoadDemo),
        data: { title: 'The road' },
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
