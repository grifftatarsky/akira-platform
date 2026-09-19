import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CommsHttpService } from '../../common/http/comms-http.service';
import { MarkdownEditorComponent } from '../../common/ui/markdown-editor.component';
import { BlogTag, DeskPost, PostDraft } from '../../model/response/comms-response.model';
import { BLOG_TAGS, SITE_BLOG_URL, whenever } from './comms-labels';

const LAST_BYLINE = 'desk.blog.byline';

@Component({
  selector: 'app-post-editor-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MarkdownEditorComponent],
  templateUrl: './post-editor-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PostEditorPage implements OnInit {
  private readonly comms = inject(CommsHttpService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly tags = BLOG_TAGS;
  protected readonly whenever = whenever;

  protected readonly post = signal<DeskPost | null>(null);
  protected readonly chosen = signal<ReadonlySet<BlogTag>>(new Set());
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);

  protected readonly isPublished = computed(() => !!this.post()?.publishedAt);
  protected readonly siteUrl = computed(() => {
    const post = this.post();
    return post?.publishedAt ? `${SITE_BLOG_URL}/${post.slug}` : null;
  });

  protected readonly form = new FormGroup({
    title: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    byline: new FormControl<string>(this.rememberedByline(), {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    summary: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(400)],
    }),
    slug: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(120)],
    }),
    body: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200_000)],
    }),
  });

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id && id !== 'new' && id !== this.post()?.id) {
        void this.load(id);
      }
    });
  }

  protected toggle(tag: BlogTag): void {
    const next = new Set(this.chosen());
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    this.chosen.set(next);
    this.form.markAsDirty();
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    await this.run(async () => {
      const existing = this.post();
      const saved = existing
        ? await firstValueFrom(this.comms.updatePost(existing.id, this.draft()))
        : await firstValueFrom(this.comms.createPost(this.draft()));
      this.remember(saved.byline);
      this.show(saved);
      this.notice.set(saved.publishedAt ? 'Saved. The site has it within a minute.' : 'Draft saved.');
      if (!existing) {
        await this.router.navigate(['/desk/posts', saved.id], { replaceUrl: true });
      }
    });
  }

  protected async publish(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    await this.run(async () => {
      const existing = this.post();
      const saved = existing
        ? await firstValueFrom(this.comms.updatePost(existing.id, this.draft()))
        : await firstValueFrom(this.comms.createPost(this.draft()));
      const published = await firstValueFrom(this.comms.publishPost(saved.id));
      this.remember(published.byline);
      this.show(published);
      this.notice.set('Published.');
      if (!existing) {
        await this.router.navigate(['/desk/posts', published.id], { replaceUrl: true });
      }
    });
  }

  protected async unpublish(): Promise<void> {
    const post = this.post();
    if (!post) return;
    await this.run(async () => {
      this.show(await firstValueFrom(this.comms.unpublishPost(post.id)));
      this.notice.set('Taken off the site. It is a draft again.');
    });
  }

  protected async remove(): Promise<void> {
    const post = this.post();
    if (!post) return;
    await this.run(async () => {
      await firstValueFrom(this.comms.deletePost(post.id));
      await this.router.navigate(['/desk']);
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.show(await firstValueFrom(this.comms.getPost(id)));
    } catch {
      this.error.set('That post could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.confirmingDelete.set(false);
    try {
      await work();
    } catch (e: unknown) {
      const detail = (e as { error?: { detail?: string } })?.error?.detail;
      this.error.set(detail ?? 'The desk could not save that. Nothing was changed.');
    } finally {
      this.saving.set(false);
    }
  }

  private show(post: DeskPost): void {
    this.post.set(post);
    this.chosen.set(new Set(post.tags));
    this.form.setValue({
      title: post.title,
      byline: post.byline,
      summary: post.summary ?? '',
      slug: post.slug,
      body: post.body,
    });
    this.form.markAsPristine();
  }

  private draft(): PostDraft {
    const value = this.form.getRawValue();
    return {
      title: value.title.trim(),
      byline: value.byline.trim(),
      summary: value.summary.trim() || null,
      tags: this.tags.map((t) => t.slug).filter((slug) => this.chosen().has(slug)),
      slug: this.form.controls.slug.dirty ? value.slug.trim() || null : null,
      body: value.body,
    };
  }

  private rememberedByline(): string {
    try {
      return localStorage.getItem(LAST_BYLINE) ?? '';
    } catch {
      return '';
    }
  }

  private remember(byline: string): void {
    try {
      localStorage.setItem(LAST_BYLINE, byline);
    } catch {
      return;
    }
  }
}
