import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { BaseHttpService } from './base-http.service';
import { COMMS_BASE_URL } from '../../app.tokens';
import {
  CategoryGuide,
  DeskPost,
  DeskPostRow,
  HandlingResult,
  MessageDetail,
  MessageRow,
  Outcome,
  PostDraft,
  ReportDetail,
  ReportRow,
  ReportStatus,
} from '../../model/response/comms-response.model';

/**
 * The abuse and contact desk.
 *
 * <p>A separate base URL from everything else here: this talks to microgpt-comms
 * through its own BFF route, not to the resource server. The service's public
 * intake is on outpostmessaging.com and never comes through the BFF at all.
 */
@Injectable({ providedIn: 'root' })
export class CommsHttpService extends BaseHttpService {
  private readonly base: string = inject(COMMS_BASE_URL);

  listReports(status?: ReportStatus): Observable<ReportRow[]> {
    return this.get<ReportRow[]>(`${this.base}/desk/reports`, status ? { status } : undefined);
  }

  getReport(id: string): Observable<ReportDetail> {
    return this.get<ReportDetail>(`${this.base}/desk/reports/${id}`);
  }

  handleReport(id: string, outcome: Outcome, referredTo?: string): Observable<HandlingResult> {
    return this.post<HandlingResult>(`${this.base}/desk/reports/${id}/handle`, {
      outcome,
      referredTo: referredTo ?? null,
    });
  }

  releaseReport(id: string): Observable<HandlingResult> {
    return this.post<HandlingResult>(`${this.base}/desk/reports/${id}/release`, {});
  }

  listMessages(): Observable<MessageRow[]> {
    return this.get<MessageRow[]>(`${this.base}/desk/messages`);
  }

  getMessage(id: string): Observable<MessageDetail> {
    return this.get<MessageDetail>(`${this.base}/desk/messages/${id}`);
  }

  closeMessage(id: string, answered: boolean): Observable<void> {
    return this.post<void>(`${this.base}/desk/messages/${id}/close?answered=${answered}`, {});
  }

  guides(): Observable<CategoryGuide[]> {
    return this.get<CategoryGuide[]>(`${this.base}/desk/guides`);
  }

  listPosts(): Observable<DeskPostRow[]> {
    return this.get<DeskPostRow[]>(`${this.base}/desk/posts`);
  }

  getPost(id: string): Observable<DeskPost> {
    return this.get<DeskPost>(`${this.base}/desk/posts/${id}`);
  }

  createPost(draft: PostDraft): Observable<DeskPost> {
    return this.post<DeskPost>(`${this.base}/desk/posts`, draft);
  }

  updatePost(id: string, draft: PostDraft): Observable<DeskPost> {
    return this.put<DeskPost>(`${this.base}/desk/posts/${id}`, draft);
  }

  publishPost(id: string): Observable<DeskPost> {
    return this.post<DeskPost>(`${this.base}/desk/posts/${id}/publish`, {});
  }

  unpublishPost(id: string): Observable<DeskPost> {
    return this.post<DeskPost>(`${this.base}/desk/posts/${id}/unpublish`, {});
  }

  deletePost(id: string): Observable<void> {
    return this.delete<void>(`${this.base}/desk/posts/${id}`);
  }
}
