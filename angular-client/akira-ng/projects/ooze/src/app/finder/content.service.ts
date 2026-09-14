import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CatalogItem } from './ooze-content.models';

export interface CatalogPageRequest {
  readonly page?: number;
  readonly size?: number;
  readonly query?: string;
  readonly includeLegacy?: boolean;
}

/** Spring Data's `PagedModel` JSON. */
export interface CatalogPage {
  readonly content: CatalogItem[];
  readonly page: {
    readonly size: number;
    readonly number: number;
    readonly totalElements: number;
    readonly totalPages: number;
  };
}

/**
 * Generic catalog API for any content type, keyed by its REST path
 * (def.apiPath). Calls the ooze resource server through the BFF (same-origin —
 * session cookie + Angular XSRF header flow automatically). Reads are public;
 * writes need a signed-in DM.
 */
@Injectable({ providedIn: 'root' })
export class ContentService {
  private readonly http = inject(HttpClient);

  private url(path: string): string {
    return `/bff/ooz/${path}`;
  }

  /**
   * One page of a catalog, filtered and ordered by the server.
   *
   * The shape is Spring Data's `PagedModel` — `content` plus a `page` envelope
   * — rather than a bare array: the bestiary is 330 creatures and the finder has
   * no business holding all of them to show twenty.
   */
  list(path: string, opts: CatalogPageRequest = {}): Observable<CatalogPage> {
    let params = new HttpParams().set('page', opts.page ?? 0);
    if (opts.size != null) params = params.set('size', opts.size);
    if (opts.query) params = params.set('query', opts.query);
    if (opts.includeLegacy === false) params = params.set('includeLegacy', false);
    return this.http.get<CatalogPage>(this.url(path), { params });
  }

  /**
   * Every base row of one item category. The editor's pickers need whole closed
   * sets — the five kinds of ammunition — which a page of names does not give.
   */
  byCategory(category: string): Observable<CatalogItem[]> {
    return this.http.get<CatalogItem[]>(`${this.url('item')}/by-category/${category}`);
  }

  /**
   * Which SRD editions this catalog draws on. Asked for separately because a
   * page can't answer it: with the edition toggle already off, the rows it
   * would have to prove itself with are exactly the ones missing.
   */
  editions(path: string): Observable<readonly string[]> {
    return this.http.get<readonly string[]>(`${this.url(path)}/editions`);
  }

  /**
   * One row in full. A list row can be a summary — the bestiary omits stat
   * blocks, or the response is well over a megabyte — so opening an entry
   * fetches the rest.
   */
  get(path: string, id: string): Observable<CatalogItem> {
    return this.http.get<CatalogItem>(`${this.url(path)}/${id}`);
  }

  create(path: string, body: Record<string, unknown>): Observable<CatalogItem> {
    return this.http.post<CatalogItem>(this.url(path), body);
  }

  update(path: string, id: string, body: Record<string, unknown>): Observable<CatalogItem> {
    return this.http.put<CatalogItem>(`${this.url(path)}/${id}`, body);
  }

  remove(path: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.url(path)}/${id}`);
  }

  /** Drop the caller's override of a base row; resolves to the base row. */
  revert(path: string, baseId: string): Observable<CatalogItem> {
    return this.http.post<CatalogItem>(`${this.url(path)}/${baseId}/revert`, {});
  }

  hide(path: string, baseId: string): Observable<void> {
    return this.http.post<void>(`${this.url(path)}/${baseId}/hide`, {});
  }

}
