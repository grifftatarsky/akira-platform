import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Battle, Combatant, Encounter, MapProp } from './board.models';

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

  /**
   * Moves a creature along a route.
   *
   * <p>The whole path, because the engine walks it a square at a time — paying
   * the live terrain cost of each and stopping at the one that leaves somebody's
   * reach. The response may come back mid-move with the phase at
   * AWAITING_REACTION, which is not an error: it is an Opportunity Attack
   * waiting to be taken.
   */
  move(
    battleId: string,
    participantId: string,
    waypoints: readonly { xHalfFeet: number; yHalfFeet: number; zHalfFeet: number }[],
  ): Observable<Battle> {
    return this.http.post<Battle>(
      `/bff/ooz/battle/${battleId}/participant/${participantId}/move`, { waypoints });
  }

  /** Resumes a move that stopped for an Opportunity Attack. */
  resumeMove(battleId: string): Observable<Battle> {
    return this.http.post<Battle>(`/bff/ooz/battle/${battleId}/resume-move`, {});
  }

  /**
   * Replaces the board's furniture.
   *
   * <p>The whole list, which is the opposite of how a token moves and for the
   * opposite reason. A token is dragged one at a time by somebody watching, so
   * each drag is its own request; furniture is arranged, and arranging is a
   * dozen small moves nobody wants a round trip for. Sending it whole also
   * means never having to describe a deletion.
   */
  setProps(encounterId: string, props: readonly MapProp[]): Observable<Encounter> {
    return this.http.put<Encounter>(`/bff/ooz/encounter/${encounterId}/map/props`, props);
  }

  /**
   * Drags a creature around a saved board, before anybody rolls Initiative.
   *
   * <p>A whole-object PUT, so the base has to travel with it: the server holds a
   * check constraint that a combatant has exactly one of a stat block or a
   * character, and dropping it would turn a drag into a constraint violation.
   */
  placeCombatant(
    encounterId: string,
    combatant: Combatant,
    at: { xHalfFeet: number; yHalfFeet: number; zHalfFeet: number },
  ): Observable<unknown> {
    return this.http.put(`/bff/ooz/encounter/${encounterId}/combatant/${combatant.id}`, {
      statBlockId: combatant.statBlockId,
      gameCharacterId: combatant.gameCharacterId,
      name: combatant.name,
      disposition: combatant.disposition,
      surprised: combatant.surprised,
      size: combatant.size,
      ...at,
    });
  }
}
