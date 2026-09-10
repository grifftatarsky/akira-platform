package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.Capability;
import com.gpt.oozengine.model.battle.Battle;
import com.gpt.oozengine.model.battle.Participant;
import com.gpt.oozengine.model.dto.response.BattleResponse;
import com.gpt.oozengine.model.encounter.Encounter;
import com.gpt.oozengine.repository.EncounterRepository;
import com.gpt.oozengine.util.Falling;
import com.gpt.oozengine.util.Geometry;
import com.gpt.oozengine.util.Geometry.Footprint;
import com.gpt.oozengine.util.Geometry.Point;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Working out what a move costs, and what it disturbs.
 *
 * <p>This side of the boundary, because every question here needs a board: what
 * the ground costs, who is standing in the way, whose reach is being left, and
 * how far it is down. The tracker gets the answers as costed legs and walks
 * them without ever learning what terrain is.
 *
 * <p>A battle with no encounter behind it still moves — every leg costs its
 * distance and provokes nobody, which is what a tracker at a table assumes.
 */
@Service
@RequiredArgsConstructor
public class BattleMovementService {

  private final BattleService battles;
  private final EncounterRepository encounters;

  /**
   * Moves a creature along a path of waypoints.
   *
   * @param waypoints positions in half-feet, in order; the creature's current
   *     position is the implied start
   */
  @Transactional
  public BattleResponse move(UUID battleId, UUID ownerId, UUID participantId,
      List<Point> waypoints) {
    Battle b = battles.get(battleId, ownerId);
    Participant mover = b.getParticipants().stream()
        .filter(p -> p.getId().equals(participantId))
        .findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
            "No participant " + participantId));

    battles.move(battleId, ownerId, participantId, plan(b, mover, waypoints));
    return battles.view(battleId, ownerId);
  }

  /** Resumes a move that stopped for an Opportunity Attack. */
  @Transactional
  public BattleResponse resume(UUID battleId, UUID ownerId) {
    battles.continueMovement(battleId, ownerId);
    return battles.view(battleId, ownerId);
  }

  /**
   * Costs each leg of a path and marks the ones that provoke.
   *
   * <p>Everything computed here and now. A square's cost depends on who is
   * standing in it and on who is asking — "a creature that isn't Tiny or your
   * ally" — so this could never have been worked out in advance and stored.
   */
  private List<MovementLeg> plan(Battle b, Participant mover, List<Point> waypoints) {
    Encounter e = b.getEncounterId() == null ? null
        : encounters.findWithBoardById(b.getEncounterId()).orElse(null);
    List<MovementLeg> legs = new ArrayList<>();
    Point from = new Point(mover.getX(), mover.getY(), mover.getZ());

    for (Point to : waypoints) {
      if (e == null) {
        // No board: a leg costs what it covers and disturbs nobody.
        legs.add(new MovementLeg(to.x(), to.y(), to.z(),
            (int) Geometry.toFeet(Geometry.distance(from, to)), List.of(), 0));
        from = to;
        continue;
      }
      var field = new Battlefield(e.getMap(), e.getMap().getCells());
      int cx = field.cellX(to.x());
      int cy = field.cellY(to.y());

      // Who the mover is leaving the reach of. "You can make an Opportunity
      // Attack when a creature that you can see leaves your reach" — so it is
      // measured on the step out, not on where it ends up.
      List<UUID> provokes = threatening(b, mover, from).stream()
          .filter(p -> !threatening(b, mover, to).contains(p))
          .toList();

      int cost = field.enterCost(cx, cy, sizeOf(b, mover), occupants(b, mover, field, cx, cy));
      int fall = Falling.dropBetween(
          field.elevationAt(field.cellX(from.x()), field.cellY(from.y())),
          field.elevationAt(cx, cy));

      legs.add(new MovementLeg(to.x(), to.y(), to.z(), cost, provokes, fall));
      from = to;
    }
    return legs;
  }

  /** Everyone whose reach covers this point and who could swing at the mover. */
  private static List<UUID> threatening(Battle b, Participant mover, Point at) {
    List<UUID> out = new ArrayList<>();
    for (Participant other : BattleService.order(b)) {
      if (other.getId().equals(mover.getId()) || other.isDown()) {
        continue;
      }
      var theirs = Footprint.of(new Point(other.getX(), other.getY(), other.getZ()),
          com.gpt.oozengine.constant.rules.CreatureSize.MEDIUM);
      var here = Footprint.of(at, com.gpt.oozengine.constant.rules.CreatureSize.MEDIUM);
      // The SRD's default: "A creature has a reach of 5 feet unless a rule says
      // otherwise." Edge to edge, so a big creature threatens further.
      if (Geometry.withinReach(theirs, here, Geometry.feet(5))) {
        out.add(other.getId());
      }
    }
    return out;
  }

  /** Who is standing in a square, and whether the mover counts them as allies. */
  private static List<Battlefield.Occupant> occupants(Battle b, Participant mover,
      Battlefield field, int cx, int cy) {
    List<Battlefield.Occupant> out = new ArrayList<>();
    for (Participant other : b.getParticipants()) {
      if (other.getId().equals(mover.getId()) || other.isDown()) {
        continue;
      }
      if (field.cellX(other.getX()) == cx && field.cellY(other.getY()) == cy) {
        // Nothing yet models sides, so everyone in the way counts as an enemy —
        // the cautious reading, and the one a DM can override by moving them.
        out.add(new Battlefield.Occupant(
            com.gpt.oozengine.constant.rules.CreatureSize.MEDIUM, false));
      }
    }
    return out;
  }

  private static com.gpt.oozengine.constant.rules.CreatureSize sizeOf(Battle b, Participant p) {
    return com.gpt.oozengine.constant.rules.CreatureSize.MEDIUM;
  }

  /** Whether this creature may share a square, which a swarm may. */
  static boolean maySharePlaces(java.util.Set<Capability> capabilities) {
    return capabilities.contains(Capability.OCCUPY_CREATURE_SPACE);
  }
}
