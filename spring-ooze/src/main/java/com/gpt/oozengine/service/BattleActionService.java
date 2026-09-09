package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.CoverDegree;
import com.gpt.oozengine.model.battle.Battle;
import com.gpt.oozengine.model.battle.Participant;
import com.gpt.oozengine.model.creature.StatBlock;
import com.gpt.oozengine.model.dto.response.BattleResponse;
import com.gpt.oozengine.model.encounter.Combatant;
import com.gpt.oozengine.model.encounter.Encounter;
import com.gpt.oozengine.model.mechanics.Feature;
import com.gpt.oozengine.repository.EncounterRepository;
import com.gpt.oozengine.repository.StatBlockRepository;
import com.gpt.oozengine.util.Geometry;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Taking an action, with the board consulted if there is one.
 *
 * <p>Lives on this side of the boundary for the same reason the launch seam
 * does: it knows about both halves, and the tracker must not. It works out what
 * the map says about each target — cover, line of sight, whether the attack even
 * reaches — and hands that to a resolver that has never heard of a map.
 *
 * <p>A battle with no encounter behind it still works; every target is simply in
 * the open, which is what a tracker at a table assumes anyway.
 */
@Service
@RequiredArgsConstructor
public class BattleActionService {

  private final BattleService battles;
  private final EncounterRepository encounters;
  private final StatBlockRepository statBlocks;

  @Transactional
  public BattleResponse act(UUID battleId, UUID ownerId, UUID actorId, UUID featureId,
      List<UUID> targetIds) {
    Battle b = battles.get(battleId, ownerId);
    Participant actor = b.getParticipants().stream()
        .filter(p -> p.getId().equals(actorId))
        .findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
            "No participant " + actorId));

    Feature feature = featureOf(actor, featureId);
    var contexts = board(b, actor, targetIds, feature);
    battles.act(battleId, ownerId, actorId, feature, targetIds, contexts);
    return battles.view(battleId, ownerId);
  }

  /**
   * The feature, found on the actor's own stat block.
   *
   * <p>Looked up through the creature rather than by id alone, so sending the
   * id of a dragon's breath weapon does not let a goblin use it.
   */
  private Feature featureOf(Participant actor, UUID featureId) {
    if (actor.getStatBlockId() == null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          actor.getName() + " has no stat block, so its actions must be adjudicated");
    }
    StatBlock sb = statBlocks.findById(actor.getStatBlockId())
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT,
            "That creature's stat block is gone"));
    return sb.getFeatures().stream()
        .filter(f -> f.getId().equals(featureId))
        .findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
            actor.getName() + " has no such feature"));
  }

  /**
   * What the map says about each target: cover, sight, and whether it is in
   * reach or range.
   *
   * <p>Everything computed live. Cover in particular cannot be cached — a
   * creature that moved two squares ago changes what the one behind it is
   * sheltered by.
   */
  private Map<UUID, TargetContext> board(Battle b, Participant actor, List<UUID> targetIds,
      Feature feature) {
    Map<UUID, TargetContext> out = new HashMap<>();
    if (b.getEncounterId() == null) {
      // No board: everyone is in the open, which is what a tracker assumes.
      targetIds.forEach(id -> out.put(id, TargetContext.open(id)));
      return out;
    }
    Encounter e = encounters.findWithBoardById(b.getEncounterId()).orElse(null);
    if (e == null || actor.getCombatantId() == null) {
      targetIds.forEach(id -> out.put(id, TargetContext.open(id)));
      return out;
    }
    var field = new Battlefield(e.getMap(), e.getMap().getCells());
    Combatant from = combatant(e, actor.getCombatantId());
    int reach = reachHalfFeet(feature);

    for (UUID targetId : targetIds) {
      Participant target = b.getParticipants().stream()
          .filter(p -> p.getId().equals(targetId)).findFirst().orElse(null);
      Combatant to = target == null || target.getCombatantId() == null
          ? null : combatant(e, target.getCombatantId());
      if (from == null || to == null) {
        out.put(targetId, TargetContext.open(targetId));
        continue;
      }
      var attacker = EncounterService.footprintOf(from);
      var defender = EncounterService.footprintOf(to);
      CoverDegree cover = field.coverBetween(attacker, defender);
      // Edge to edge, so a Gargantuan creature threatens what its centre could
      // never reach.
      boolean inRange = Geometry.withinReach(attacker, defender, reach);
      out.put(targetId, TargetContext.of(targetId, cover, inRange));
    }
    return out;
  }

  /**
   * How far the feature reaches, in half-feet.
   *
   * <p>The longest of its steps' reach and range, because a Melee or Ranged
   * attack is one feature with both, and the SRD's default when nothing says
   * otherwise: "A creature has a reach of 5 feet unless a rule says otherwise."
   */
  private static int reachHalfFeet(Feature feature) {
    int best = 0;
    for (var step : feature.getSteps()) {
      if (step.getReachFeet() != null) {
        best = Math.max(best, Geometry.feet(step.getReachFeet()));
      }
      if (step.getRangeFeet() != null) {
        best = Math.max(best, Geometry.feet(step.getRangeFeet()));
      }
      if (step.getRangeLongFeet() != null) {
        best = Math.max(best, Geometry.feet(step.getRangeLongFeet()));
      }
    }
    return best == 0 ? Geometry.feet(5) : best;
  }

  private static Combatant combatant(Encounter e, UUID id) {
    return e.getCombatants().stream().filter(c -> c.getId().equals(id)).findFirst().orElse(null);
  }
}
