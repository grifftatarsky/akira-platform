import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CommsHttpService } from '../../common/http/comms-http.service';
import {
  MessageRow,
  ReportRow,
} from '../../model/response/comms-response.model';
import {
  CATEGORY_LABELS,
  HELD_BY_LAW,
  PRODUCT_LABELS,
  STATUS_LABELS,
  waiting,
  whenever,
} from './comms-labels';

type Tab = 'reports' | 'messages';

@Component({
  selector: 'app-comms-desk-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './comms-desk-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommsDeskPage implements OnInit {
  private readonly comms = inject(CommsHttpService);

  protected readonly tab = signal<Tab>('reports');
  protected readonly reports = signal<ReportRow[]>([]);
  protected readonly messages = signal<MessageRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly productLabels = PRODUCT_LABELS;
  protected readonly heldByLaw = HELD_BY_LAW;
  protected readonly whenever = whenever;
  protected readonly waiting = waiting;

  /*
   * Waiting first, and inside that oldest first, which is how the service
   * returns them. A queue read newest-first starves its own bottom, and the
   * bottom of this one is whoever has been waiting longest to hear anything.
   */
  protected readonly waitingReports = computed(() =>
    this.reports().filter((r) => r.status === 'NEW'),
  );

  protected readonly heldReports = computed(() =>
    this.reports().filter((r) => r.holdUntil !== null),
  );

  protected readonly settledReports = computed(() =>
    this.reports().filter((r) => r.status !== 'NEW' && r.holdUntil === null),
  );

  protected readonly waitingMessages = computed(() =>
    this.messages().filter((m) => m.status === 'NEW'),
  );

  protected readonly settledMessages = computed(() =>
    this.messages().filter((m) => m.status !== 'NEW'),
  );

  protected readonly dueNow = computed(() =>
    this.heldReports().filter((r) => r.releasable).length,
  );

  ngOnInit(): void {
    void this.load();
  }

  protected show(tab: Tab): void {
    this.tab.set(tab);
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [reports, messages] = await Promise.all([
        firstValueFrom(this.comms.listReports()),
        firstValueFrom(this.comms.listMessages()),
      ]);
      this.reports.set(reports ?? []);
      this.messages.set(messages ?? []);
    } catch {
      this.error.set(
        'The desk could not be reached. Either the comms service is down or this account does not carry COMMS_DESK.',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
