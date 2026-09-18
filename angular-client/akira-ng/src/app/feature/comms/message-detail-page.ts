import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CommsHttpService } from '../../common/http/comms-http.service';
import { MessageDetail } from '../../model/response/comms-response.model';
import { PRODUCT_LABELS, whenever } from './comms-labels';

@Component({
  selector: 'app-message-detail-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './message-detail-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageDetailPage implements OnInit {
  private readonly comms = inject(CommsHttpService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly message = signal<MessageDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly closed = signal(false);

  protected readonly productLabels = PRODUCT_LABELS;
  protected readonly whenever = whenever;

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/desk']);
      return;
    }
    try {
      this.message.set(await firstValueFrom(this.comms.getMessage(id)));
    } catch {
      this.error.set('That message could not be opened.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async close(answered: boolean): Promise<void> {
    const message = this.message();
    if (!message || this.saving()) return;
    this.saving.set(true);
    try {
      await firstValueFrom(this.comms.closeMessage(message.id, answered));
      this.closed.set(true);
    } catch {
      this.error.set('That did not save, and nothing was changed.');
    } finally {
      this.saving.set(false);
    }
  }
}
