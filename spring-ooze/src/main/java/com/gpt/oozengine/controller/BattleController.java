package com.gpt.oozengine.controller;

import com.gpt.oozengine.constant.rules.Disposition;
import com.gpt.oozengine.model.battle.Participant;
import com.gpt.oozengine.model.dto.request.ActionRequest;
import com.gpt.oozengine.model.dto.request.BattleRequest;
import com.gpt.oozengine.model.dto.request.HitPointChangeRequest;
import com.gpt.oozengine.model.dto.request.ReactionRequest;
import com.gpt.oozengine.model.dto.request.ParticipantRequest;
import com.gpt.oozengine.model.dto.response.BattleResponse;
import com.gpt.oozengine.model.dto.response.BattleSummaryResponse;
import com.gpt.oozengine.model.dto.response.ParticipantResponse;
import com.gpt.oozengine.service.BattleActionService;
import com.gpt.oozengine.service.BattleService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.data.web.PagedModel;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Running a fight.
 *
 * <p>Usable entirely on its own — nothing here needs an encounter, and the
 * routes take participants a DM typed rather than creatures lifted off a board.
 * The seam that lifts an encounter into a battle lives on the encounter side,
 * where the code already knows about both.
 *
 * <p>Every route needs {@code MANAGE_CONTENT} and is scoped to the caller.
 */
@RestController
@RequestMapping("battle")
@RequiredArgsConstructor
@PreAuthorize("hasAuthority('MANAGE_CONTENT')")
@Tag(name = "Battles")
public class BattleController {

  private final BattleService battles;
  private final BattleActionService actions;

  @GetMapping
  public PagedModel<BattleSummaryResponse> list(
      @PageableDefault(size = 25) Pageable pageable, @AuthenticationPrincipal Jwt jwt) {
    return new PagedModel<>(battles.list(userId(jwt), pageable));
  }

  @GetMapping("/{id}")
  public BattleResponse get(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    return battles.view(id, userId(jwt));
  }

  @PostMapping
  public ResponseEntity<BattleResponse> create(
      @Valid @RequestBody BattleRequest req, @AuthenticationPrincipal Jwt jwt) {
    return ResponseEntity.ok(battles.createAndView(userId(jwt), req.name(), req.seed()));
  }

  @PostMapping("/{id}/participant")
  public BattleResponse add(
      @PathVariable UUID id,
      @Valid @RequestBody ParticipantRequest req,
      @AuthenticationPrincipal Jwt jwt) {
    return battles.addAndView(id, userId(jwt), participant(req));
  }

  /** Rolls for everyone in the fight and opens the first turn. */
  @PostMapping("/{id}/initiative")
  public BattleResponse rollInitiative(
      @PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    return battles.rollInitiativeAndView(id, userId(jwt));
  }

  /**
   * Moves the fight on by one step.
   *
   * <p>One step, not one turn: from a turn it closes it and stops at the pause,
   * and from the pause it opens the next. Two calls to cross a turn boundary is
   * the design — the pause is where a DM acts.
   */
  @PostMapping("/{id}/advance")
  public BattleResponse advance(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    return battles.advanceAndView(id, userId(jwt));
  }

  /** Walks an on-deck creature into the fight; it rolls Initiative on arrival. */
  @PostMapping("/{id}/participant/{participantId}/promote")
  public BattleResponse promote(
      @PathVariable UUID id,
      @PathVariable UUID participantId,
      @AuthenticationPrincipal Jwt jwt) {
    return battles.promoteAndView(id, userId(jwt), participantId);
  }

  /**
   * The acting creature takes an action.
   *
   * <p>The board is consulted here if there is one — cover, line of sight and
   * reach are worked out and handed to a resolver that has never heard of a map.
   * A battle with no encounter behind it still works; every target is simply in
   * the open.
   */
  @PostMapping("/{id}/participant/{participantId}/act")
  public BattleResponse act(
      @PathVariable UUID id,
      @PathVariable UUID participantId,
      @Valid @RequestBody ActionRequest req,
      @AuthenticationPrincipal Jwt jwt) {
    return actions.act(id, userId(jwt), participantId, req.featureId(), req.targets());
  }

  /**
   * Declares an action and stops, so a reaction can land.
   *
   * <p>The response carries the window: the phase is AWAITING_REACTION and the
   * log's last line names everyone who could react.
   */
  @PostMapping("/{id}/participant/{participantId}/declare")
  public BattleResponse declare(
      @PathVariable UUID id,
      @PathVariable UUID participantId,
      @Valid @RequestBody ActionRequest req,
      @AuthenticationPrincipal Jwt jwt) {
    return actions.declare(id, userId(jwt), participantId, req.featureId(), req.targets());
  }

  /**
   * Takes a reaction, and says what it does to the action in flight.
   *
   * <p>Cancel, retarget or modify a defence. The engine does not judge whether
   * the reaction's trigger applies — it shows the book's words and the DM rules.
   */
  @PostMapping("/{id}/participant/{participantId}/react")
  public BattleResponse react(
      @PathVariable UUID id,
      @PathVariable UUID participantId,
      @Valid @RequestBody ReactionRequest req,
      @AuthenticationPrincipal Jwt jwt) {
    return battles.reactAndView(id, userId(jwt), participantId, req.reactionName(), req.kind(),
        req.newTargetIds(), req.armorClassDelta(), req.reason());
  }

  /** Closes the window and resolves whatever is left of the action. */
  @PostMapping("/{id}/resolve")
  public BattleResponse resolve(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    return actions.resolve(id, userId(jwt));
  }

  @PostMapping("/{id}/participant/{participantId}/hit-points")
  public ParticipantResponse changeHitPoints(
      @PathVariable UUID id,
      @PathVariable UUID participantId,
      @Valid @RequestBody HitPointChangeRequest req,
      @AuthenticationPrincipal Jwt jwt) {
    return battles.changeHitPointsAndView(
        id, userId(jwt), participantId, req.delta(), req.reason());
  }

  @PostMapping("/{id}/participant/{participantId}/condition/{condition}")
  public ParticipantResponse applyCondition(
      @PathVariable UUID id,
      @PathVariable UUID participantId,
      @PathVariable String condition,
      @AuthenticationPrincipal Jwt jwt) {
    return battles.applyConditionAndView(id, userId(jwt), participantId, condition);
  }

  @DeleteMapping("/{id}/participant/{participantId}/condition/{condition}")
  public ParticipantResponse removeCondition(
      @PathVariable UUID id,
      @PathVariable UUID participantId,
      @PathVariable String condition,
      @AuthenticationPrincipal Jwt jwt) {
    return battles.removeConditionAndView(id, userId(jwt), participantId, condition);
  }

  /** A line in the log that changes nothing — the "things to consider" surface. */
  @PostMapping("/{id}/note")
  public BattleResponse note(
      @PathVariable UUID id,
      @RequestParam(required = false) UUID participantId,
      @RequestBody String text,
      @AuthenticationPrincipal Jwt jwt) {
    return battles.noteAndView(id, userId(jwt), participantId, text);
  }

  /**
   * Rewinds to just after an event.
   *
   * <p>The log is truncated and the state refolded, so this is the same fight a
   * step earlier rather than a patched version of the current one — which is why
   * it is addressed by a sequence a client reads off the log.
   */
  @PostMapping("/{id}/rewind/{sequence}")
  public BattleResponse rewind(
      @PathVariable UUID id, @PathVariable long sequence, @AuthenticationPrincipal Jwt jwt) {
    return battles.rewindAndView(id, userId(jwt), sequence);
  }

  @PostMapping("/{id}/end")
  public BattleResponse end(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    return battles.endAndView(id, userId(jwt));
  }

  private static Participant participant(ParticipantRequest req) {
    Participant p = new Participant();
    p.setName(req.name());
    p.setMaxHitPoints(req.maxHitPoints());
    p.setInitiativeBonus(req.initiativeBonus() == null ? 0 : req.initiativeBonus());
    p.setInitiativeTiebreak(req.initiativeTiebreak() == null ? 0 : req.initiativeTiebreak());
    p.setSurprised(Boolean.TRUE.equals(req.surprised()));
    p.setDisposition(req.disposition() == null ? Disposition.ACTIVE : req.disposition());
    p.setStatBlockId(req.statBlockId());
    p.setGameCharacterId(req.gameCharacterId());
    p.setCombatantId(req.combatantId());
    p.setNotes(req.notes());
    return p;
  }

  private static UUID userId(Jwt jwt) {
    return UUID.fromString(jwt.getSubject());
  }
}
