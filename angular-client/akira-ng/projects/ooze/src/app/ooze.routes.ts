import { Routes } from '@angular/router';
import { OozeLayout } from './shell/ooze-layout';
import { OozeDashboard } from './dashboard/ooze-dashboard';

export const OOZE_ROUTES: Routes = [
  {
    path: '',
    component: OozeLayout,
    children: [
      { path: '', component: OozeDashboard, data: { title: 'Oozengine' } },
      {

        path: 'board',
        loadComponent: () => import('./board/board-demo').then(m => m.BoardDemo),
        data: { title: 'Board preview' },
      },
      {

        path: 'encounters',
        loadComponent: () =>
          import('./encounters/encounter-list').then(m => m.EncounterList),
        data: { title: 'Encounters' },
      },
      {

        path: 'board/bab-dungeon',
        loadComponent: () => import('./board/bab/bab-dungeon').then(m => m.BabDungeon),

        data: { title: 'The undercroft, on Babylon', full: true },
      },
      {

        path: 'board/lab',
        loadComponent: () => import('./board/lab/lab-index').then(m => m.LabIndex),
        data: { title: 'The graphics lab' },
      },
      {
        path: 'board/lab/:id',
        loadComponent: () => import('./board/lab/lab-screen').then(m => m.LabScreen),
        data: { title: 'Lab', full: true },
      },
      {

        path: 'board/bab',
        loadComponent: () => import('./board/bab/bab-board').then(m => m.BabBoard),
        data: { title: 'The road, on Babylon', full: true },
      },
      {

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

        path: 'board/:encounterId',
        loadComponent: () => import('./board/board-page').then(m => m.BoardPage),
        data: { title: 'Board' },
      },
    ],
  },
];
