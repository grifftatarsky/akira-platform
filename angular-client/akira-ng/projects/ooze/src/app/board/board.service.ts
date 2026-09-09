import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Battle, Encounter } from './board.models';

/**
 * The board's half of the ooze API.
 *
 * <p>Through the BFF, same-origin, so the session cookie and the XSRF header
 * flow on their own. Every route here needs a signed-in DM: an encounter is a
 * plan for a session and the players are not supposed to see it.
 */
@Injectable({ providedIn: 'root' })
export class BoardService {
  private readonly http = inject(HttpClient);

  encounter(id: string): Observable<Encounter> {
    return this.http.get<Encounter>(`/bff/ooz/encounter/${id}`);
  }

  battle(id: string): Observable<Battle> {
    return this.http.get<Battle>(`/bff/ooz/battle/${id}`);
  }

  /** One step of the fight. Two calls cross a turn, because the pause is real. */
  advance(battleId: string): Observable<Battle> {
    return this.http.post<Battle>(`/bff/ooz/battle/${battleId}/advance`, {});
  }
}
