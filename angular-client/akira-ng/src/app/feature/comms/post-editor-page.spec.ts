import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { createSpyObj, type SpyObj } from '../../testing/mock';
import { CommsHttpService } from '../../common/http/comms-http.service';
import { DeskPost, PostDraft } from '../../model/response/comms-response.model';
import { PostEditorPage } from './post-editor-page';

const saved = (draft: PostDraft, publishedAt: string | null = null): DeskPost => ({
  id: 'p1',
  slug: 'first-light',
  title: draft.title,
  byline: draft.byline,
  summary: draft.summary,
  tags: draft.tags,
  body: draft.body,
  publishedAt,
  updatedAt: '2026-09-19T00:00:00Z',
  version: 0,
});

describe('PostEditorPage', () => {
  let http: SpyObj<CommsHttpService>;
  let page: PostEditorPage;
  let form: PostEditorPage['form'];

  beforeEach(() => {
    http = createSpyObj<CommsHttpService>(['createPost', 'updatePost', 'publishPost', 'getPost']);
    http.createPost.mockImplementation((d: PostDraft) => of(saved(d)));
    http.updatePost.mockImplementation((_id: string, d: PostDraft) => of(saved(d)));
    TestBed.configureTestingModule({
      providers: [
        { provide: CommsHttpService, useValue: http },
        provideRouter([]),
        provideZonelessChangeDetection(),
      ],
    });
    page = TestBed.createComponent(PostEditorPage).componentInstance;
    form = (page as unknown as { form: PostEditorPage['form'] }).form;
    form.setValue({ title: 'First light', byline: 'Griff', summary: '', slug: '', body: 'Hello.' });
  });

  const act = (editor: PostEditorPage) => editor as unknown as {
    toggle(tag: string): void;
    save(): Promise<void>;
  };

  it('sends tags in the site order, whatever order they were chosen in', async () => {
    act(page).toggle('bullet');
    act(page).toggle('release-notes');
    await act(page).save();
    expect(http.createPost.mock.calls[0][0].tags).toEqual(['release-notes', 'bullet']);
  });

  it('leaves the address to the title until somebody edits it', async () => {
    await act(page).save();
    form.controls.title.setValue('Second light');
    form.controls.title.markAsDirty();
    await act(page).save();
    expect(http.updatePost.mock.calls[0][1].slug).toBeNull();

    form.controls.slug.setValue('on-purpose');
    form.controls.slug.markAsDirty();
    await act(page).save();
    expect(http.updatePost.mock.calls[1][1].slug).toBe('on-purpose');
  });

  it('sends a blank summary as none', async () => {
    form.controls.summary.setValue('   ');
    await act(page).save();
    expect(http.createPost.mock.calls[0][0].summary).toBeNull();
  });
});
