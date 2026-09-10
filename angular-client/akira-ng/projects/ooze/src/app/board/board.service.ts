import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { Battle, BattleMap, Combatant, Encounter, MapProp } from './board.models';

/**
 * An encounter in a list, without its board.
 *
 * <p>The server sends summaries for a list on purpose: a page of forty full
 * boards to render forty names is a lot of board nobody is looking at.
 */
export interface EncounterSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly width: number;
  readonly height: number;
  readonly cellFeet: number;
  readonly combatantCount: number;
}

/** Spring Data's `PagedModel` envelope. */
interface Paged<T> {
  readonly content: T[];
  readonly page: { readonly totalElements: number };
}

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

  /** The caller's own encounters. Somebody else's are a 404, not a 403. */
  encounters(): Observable<EncounterSummary[]> {
    return this.http
      .get<Paged<EncounterSummary>>('/bff/ooz/encounter', {
        params: new HttpParams().set('size', 50),
      })
      .pipe(map(page => page.content));
  }

  /**
   * Makes an encounter.
   *
   * <p>The board is optional, and the server defaults it to a plain twenty-by-
   * twenty at five feet a square — a DM who wants to drop monsters somewhere
   * and think about terrain later should not have to describe a board first.
   * Passing one creates the whole level, painted and furnished, in a single
   * request.
   */
  createEncounter(name: string, board?: Omit<BattleMap, 'id'>): Observable<Encounter> {
    return this.http.post<Encounter>('/bff/ooz/encounter', { name, map: board });
  }

  deleteEncounter(id: string): Observable<void> {
    return this.http.delete<void>(`/bff/ooz/encounter/${id}`);
  }

  /**
   * Puts a creature from the bestiary on the board.
   *
   * <p>Two calls, because a bestiary *list* row is a summary and does not carry
   * a stat block — and a combatant is anchored to the block, not to the monster
   * entry, since that is what a fight actually reads. Fetching the one monster
   * the DM picked is the cheapest place to resolve it; the alternative is
   * sending three hundred stat blocks to a search box.
   */
  placeMonster(
    encounterId: string,
    monsterId: string,
    at: { xHalfFeet: number; yHalfFeet: number },
  ): Observable<unknown> {
    return this.http.get<{ statBlock: { id: string } | null }>(`/bff/ooz/monster/${monsterId}`)
      .pipe(switchMap(monster => this.http.post(
        `/bff/ooz/encounter/${encounterId}/combatant`,
        { statBlockId: monster.statBlock?.id, ...at, zHalfFeet: 0 })));
  }

  removeCombatant(encounterId: string, combatantId: string): Observable<void> {
    return this.http.delete<void>(
      `/bff/ooz/encounter/${encounterId}/combatant/${combatantId}`);
  }

  /**
   * Lifts a saved encounter into a running fight.
   *
   * <p>The lift copies rather than links, so playing the fight leaves the board
   * it came from untouched — which is why a battle is a separate thing with its
   * own id rather than a flag on the encounter.
   *
   * <p>No seed is sent. The server chooses one and records it, so a fight is
   * reproducible either way and an undo rewinds into the same battle rather
   * than into a new one.
   */
  launchBattle(encounterId: string, name: string): Observable<Battle> {
    return this.http.post<Battle>(`/bff/ooz/encounter/${encounterId}/battle`, { name });
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
