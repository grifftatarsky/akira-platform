import { Routes } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import { Home } from './feature/home/home';
import { Dashboard } from './feature/dashboard/dashboard';
import { ShelvesPage } from './feature/shelves/shelves-page';
import { ShelfDetailPage } from './feature/shelves/shelf-detail-page';
import { ElectionsPage } from './feature/elections/elections-page';
import { ElectionDetailPage } from './feature/elections/election-detail-page';
import { BookDetailPage } from './feature/books/book-detail-page';
import { DocsPage } from './feature/docs/docs-page';
import { AboutPage } from './feature/about/about-page';
import { ActivityFeedPage } from './feature/activity/activity-feed-page';
import { BlogListPage } from './feature/blog/blog-list-page';
import { BlogDetailPage } from './feature/blog/blog-detail-page';
import { BlogEditorPage } from './feature/blog/blog-editor-page';
import { LoginPrompt } from './feature/login/login-prompt';
import { OozeUnavailable } from './feature/ooze/ooze-unavailable';
import { PresidentUnavailable } from './feature/president/president-unavailable';
import { JpssUnavailable } from './feature/jpss/jpss-unavailable';
import { CommsDeskPage } from './feature/comms/comms-desk-page';
import { PostEditorPage } from './feature/comms/post-editor-page';
import { ReportDetailPage } from './feature/comms/report-detail-page';
import { MessageDetailPage } from './feature/comms/message-detail-page';
import { authGuard } from './auth/auth.guard';
import { commsDeskGuard } from './auth/comms-desk.guard';
import { postAdminGuard } from './auth/post-admin.guard';

export const routes: Routes = [
  { path: '', component: Home, data: { title: 'Home' } },
  { path: 'login', component: LoginPrompt, data: { title: 'Login' } },
  { path: 'dashboard', component: Dashboard, canActivate: [authGuard], data: { title: 'Dashboard' } },
  { path: 'shelves', component: ShelvesPage, canActivate: [authGuard], data: { title: 'Shelves' } },
  { path: 'shelves/:id', component: ShelfDetailPage, canActivate: [authGuard], data: { title: 'Shelf Detail' } },
  { path: 'elections', component: ElectionsPage, canActivate: [authGuard], data: { title: 'Elections' } },
  { path: 'elections/:id', component: ElectionDetailPage, canActivate: [authGuard], data: { title: 'Election Detail' } },
  { path: 'books/:id', component: BookDetailPage, canActivate: [authGuard], data: { title: 'Book Detail' } },
  { path: 'activity', component: ActivityFeedPage, canActivate: [authGuard], data: { title: 'Activity' } },
  { path: 'blog', component: BlogListPage, data: { title: 'Blog' } },
  { path: 'blog/new', component: BlogEditorPage, canActivate: [authGuard, postAdminGuard], data: { title: 'New post' } },
  { path: 'blog/:id', component: BlogDetailPage, data: { title: 'Post' } },
  { path: 'blog/:id/edit', component: BlogEditorPage, canActivate: [authGuard, postAdminGuard], data: { title: 'Edit post' } },
  { path: 'desk', component: CommsDeskPage, canActivate: [authGuard, commsDeskGuard], data: { title: 'Desk' } },
  { path: 'desk/reports/:id', component: ReportDetailPage, canActivate: [authGuard, commsDeskGuard], data: { title: 'Report' } },
  { path: 'desk/messages/:id', component: MessageDetailPage, canActivate: [authGuard, commsDeskGuard], data: { title: 'Message' } },
  { path: 'desk/posts/:id', component: PostEditorPage, canActivate: [authGuard, commsDeskGuard], data: { title: 'Post' } },
  { path: 'docs', component: DocsPage, data: { title: 'Docs' } },
  { path: 'about', component: AboutPage, data: { title: 'About' } },
  {
    path: 'ooze',
    loadChildren: () =>
      loadRemoteModule('ooze', './routes')
        .then(m => m.OOZE_ROUTES)
        .catch(() => [
          { path: '**', component: OozeUnavailable, data: { title: 'Oozengine' } },
        ]),
    data: { title: 'Oozengine' },
  },
  {
    path: 'games/president',
    loadChildren: () =>
      loadRemoteModule('president', './routes')
        .then(m => m.PRESIDENT_ROUTES)
        .catch(() => [
          { path: '**', component: PresidentUnavailable, data: { title: 'President' } },
        ]),
    data: { title: 'President' },
  },
  {
    path: 'stickers',
    loadChildren: () =>
      loadRemoteModule('jpss-ui', './routes')
        .then(m => m.JPSS_ROUTES)
        .catch(() => [
          { path: '**', component: JpssUnavailable, data: { title: 'Jo Peace Stickers' } },
        ]),
    data: { title: 'Jo Peace Stickers' },
  },
  { path: '**', redirectTo: '/' },
];
