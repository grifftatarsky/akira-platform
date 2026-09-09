package com.gpt.oozengine.controller;

import com.gpt.oozengine.model.dto.request.CombatantRequest;
import com.gpt.oozengine.model.dto.request.EncounterRequest;
import com.gpt.oozengine.model.dto.request.PaintRequest;
import com.gpt.oozengine.model.dto.response.CombatantResponse;
import com.gpt.oozengine.model.dto.response.EncounterResponse;
import com.gpt.oozengine.model.dto.response.EncounterSummaryResponse;
import com.gpt.oozengine.service.EncounterService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Building a board.
 *
 * <p>Encounters are a DM's working data, not catalog content: there is no
 * copy-on-write, no hidden-content machinery and no public read. Every route
 * needs {@code MANAGE_CONTENT} and is scoped to the caller's own encounters,
 * including the reads — an encounter is a plan for a session, and the players
 * are not supposed to see it.
 *
 * <p>Someone else's encounter is a 404, not a 403, so the existence of an id
 * does not leak.
 */
@RestController
@RequestMapping("encounter")
@RequiredArgsConstructor
@PreAuthorize("hasAuthority('MANAGE_CONTENT')")
@Tag(name = "Encounters")
public class EncounterController {

  private final EncounterService encounters;

  /** Summaries, not boards: a page of forty full boards is a lot nobody reads. */
  @GetMapping
  public PagedModel<EncounterSummaryResponse> list(
      @PageableDefault(size = 25) Pageable pageable, @AuthenticationPrincipal Jwt jwt) {
    return new PagedModel<>(encounters.list(requireUserId(jwt), pageable));
  }

  @GetMapping("/{id}")
  public EncounterResponse get(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    return encounters.view(id, requireUserId(jwt));
  }

  @PostMapping
  public ResponseEntity<EncounterResponse> create(
      @Valid @RequestBody EncounterRequest req, @AuthenticationPrincipal Jwt jwt) {
    return ResponseEntity.ok(encounters.createAndView(requireUserId(jwt), req));
  }

  /** Renames and repaints. The cell list replaces the painting rather than patching it. */
  @PutMapping("/{id}")
  public EncounterResponse update(
      @PathVariable UUID id,
      @Valid @RequestBody EncounterRequest req,
      @AuthenticationPrincipal Jwt jwt) {
    return encounters.updateAndView(id, requireUserId(jwt), req);
  }

  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    encounters.delete(id, requireUserId(jwt));
    return ResponseEntity.noContent().build();
  }

  /**
   * Paints strokes onto the board, in order.
   *
   * <p>A list rather than one, so "outline the room, then flood it with water,
   * then erase the doorway" is a single request and a single version bump.
   */
  @PostMapping("/{id}/map/paint")
  public EncounterResponse paint(
      @PathVariable UUID id,
      @Valid @RequestBody List<PaintRequest> strokes,
      @AuthenticationPrincipal Jwt jwt) {
    return encounters.paint(id, requireUserId(jwt), strokes);
  }

  // region Combatants
  //
  // Their own routes rather than a nested list on the encounter body: a DM
  // drags one token at a time, and a whole-board PUT to move a goblin five feet
  // would make every such nudge a chance to clobber someone else's edit.

  @PostMapping("/{id}/combatant")
  public ResponseEntity<CombatantResponse> place(
      @PathVariable UUID id,
      @Valid @RequestBody CombatantRequest req,
      @AuthenticationPrincipal Jwt jwt) {
    return ResponseEntity.ok(encounters.placeAndView(id, requireUserId(jwt), req));
  }

  @PutMapping("/{id}/combatant/{combatantId}")
  public CombatantResponse updateCombatant(
      @PathVariable UUID id,
      @PathVariable UUID combatantId,
      @Valid @RequestBody CombatantRequest req,
      @AuthenticationPrincipal Jwt jwt) {
    return encounters.updateCombatantAndView(id, requireUserId(jwt), combatantId, req);
  }

  @DeleteMapping("/{id}/combatant/{combatantId}")
  public ResponseEntity<Void> removeCombatant(
      @PathVariable UUID id,
      @PathVariable UUID combatantId,
      @AuthenticationPrincipal Jwt jwt) {
    encounters.removeCombatant(id, requireUserId(jwt), combatantId);
    return ResponseEntity.noContent().build();
  }
  // endregion

  private static UUID requireUserId(Jwt jwt) {
    return UUID.fromString(jwt.getSubject());
  }
}
