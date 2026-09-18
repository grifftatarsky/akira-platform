import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CommsHttpService } from '../../common/http/comms-http.service';
import {
  CategoryGuide,
  HandlingResult,
  Outcome,
  ReportDetail,
} from '../../model/response/comms-response.model';
import { CATEGORY_LABELS, HELD_BY_LAW, STATUS_LABELS, whenever } from './comms-labels';

@Component({
  selector: 'app-report-detail-page',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './report-detail-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportDetailPage implements OnInit {
  private readonly comms = inject(CommsHttpService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly report = signal<ReportDetail | null>(null);
  protected readonly guide = signal<CategoryGuide | null>(null);
  protected readonly result = signal<HandlingResult | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected outcome: Outcome = 'REFERRED';
  protected referredTo = '';

  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly heldByLaw = HELD_BY_LAW;
  protected readonly whenever = whenever;

  protected readonly isOpen = computed(() => this.report()?.status === 'NEW');

  /**
   * Whether the reporter will actually be told. Shown beside the button, because
   * the button's consequence changes with it: a report nobody can be told about
   * is deleted straight away, and one that can be is deleted only after the mail
   * goes.
   */
  protected readonly willTell = computed(() => {
    const report = this.report();
    return !!report?.wantsReply && !!report?.contactEmail;
  });

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/desk']);
      return;
    }
    this.loading.set(true);
    try {
      const report = await firstValueFrom(this.comms.getReport(id));
      this.report.set(report);
      const guides = await firstValueFrom(this.comms.guides());
      const slug = report.category.toLowerCase().replace(/_/g, '-');
      this.guide.set(guides?.find((g) => g.slug === slug) ?? null);
    } catch {
      this.error.set('That report could not be opened. It may already have been deleted.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async handle(): Promise<void> {
    const report = this.report();
    if (!report || this.saving()) return;

    if (this.outcome === 'REFERRED' && !this.referredTo.trim()) {
      this.error.set('Say who it was referred to. The reporter is told this.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(
        this.comms.handleReport(report.id, this.outcome, this.referredTo.trim() || undefined),
      );
      this.result.set(result);
    } catch (failure) {
      this.error.set(
        (failure as { error?: { detail?: string } })?.error?.detail ??
          'That did not save, and nothing was changed.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected async release(): Promise<void> {
    const report = this.report();
    if (!report || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      this.result.set(await firstValueFrom(this.comms.releaseReport(report.id)));
    } catch (failure) {
      this.error.set(
        (failure as { error?: { detail?: string } })?.error?.detail ??
          'That did not save, and nothing was changed.',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
