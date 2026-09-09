package com.gpt.oozengine.service;

import com.gpt.oozengine.model.battle.Battle;
import com.gpt.oozengine.model.battle.Participant;
import com.gpt.oozengine.model.creature.StatBlock;
import com.gpt.oozengine.model.dto.response.BattleResponse;
import com.gpt.oozengine.model.encounter.Combatant;
import com.gpt.oozengine.model.encounter.Encounter;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Lifting a saved encounter into a running fight.
 *
 * <p><b>This is the only place the two halves meet, and it lives on this side on
 * purpose.</b> The simulator knows about the tracker; the tracker knows nothing
 * about the simulator, and that is what lets it ship alone. Putting this seam in
 * {@code BattleService} would have inverted the dependency and quietly made the
 * tracker need a board.
 *
 * <p>The lift is a copy, not a link. Participants take their opening numbers
 * from the combatants and then go their own way, so a fight can be run ten times
 * from one encounter and leave it exactly as it was — which is the whole reason
 * the two are separate types.
 */
@Service
@RequiredArgsConstructor
public class EncounterLaunchService {

  private final EncounterService encounters;
  private final BattleService battles;

  /**
   * Starts a battle from an encounter, without rolling Initiative.
   *
   * <p>Deliberately stops short of the roll: a DM lifting a board into a tracker
   * usually still has someone to add — the players, most often, who are not on
   * the map — and Initiative is the one thing that cannot be un-rolled without
   * a rewind.
   */
  @Transactional
  public BattleResponse launch(UUID encounterId, UUID ownerId, String name, Long seed) {
    Encounter e = encounters.get(encounterId, ownerId);
    Battle b = battles.create(ownerId, name == null || name.isBlank() ? e.getName() : name, seed);
    b.setEncounterId(e.getId());

    for (Combatant c : e.getCombatants()) {
      battles.add(b.getId(), ownerId, participantOf(c));
    }
    return BattleResponse.from(battles.get(b.getId(), ownerId));
  }

  private static Participant participantOf(Combatant c) {
    // The effective block, so a creature a DM performed surgery on fights with
    // its own numbers rather than the book's.
    StatBlock sb = c.effectiveStatBlock() != null ? c.effectiveStatBlock()
        : c.getGameCharacter() != null ? c.getGameCharacter().getStatBlock() : null;

    Participant p = new Participant();
    p.setCombatantId(c.getId());
    p.setStatBlockId(sb == null ? null : sb.getId());
    p.setGameCharacterId(c.getGameCharacter() == null ? null : c.getGameCharacter().getId());
    p.setName(displayName(c, sb));
    p.setMaxHitPoints(hitPoints(c, sb));
    p.setInitiativeBonus(sb == null || sb.getInitiativeBonus() == null
        ? 0 : sb.getInitiativeBonus());
    // Dexterity breaks ties, which is the common table convention, and having it
    // stored means the order is stable across reads rather than depending on
    // whatever the database felt like returning first.
    p.setInitiativeTiebreak(sb == null || sb.getDexterity() == null ? 0 : sb.getDexterity());
    // Both carried across: a creature placed asleep on the balcony was placed
    // that way for a reason, and losing it here would silently disarm the ambush.
    p.setSurprised(c.isSurprised());
    p.setDisposition(c.getDisposition());
    p.setNotes(c.getNotes());
    return p;
  }

  private static String displayName(Combatant c, StatBlock sb) {
    if (c.getName() != null && !c.getName().isBlank()) {
      return c.getName();
    }
    if (c.getGameCharacter() != null && c.getGameCharacter().getName() != null) {
      return c.getGameCharacter().getName();
    }
    return sb == null ? "Combatant" : "Creature";
  }

  /**
   * The creature's hit points: the DM's override, else the book's average.
   *
   * <p>The average rather than a roll, because a saved encounter run twice
   * should open the same way; rolling here would make the first thing that
   * happens in every battle a number nobody chose and nobody can reproduce
   * without the log.
   */
  private static int hitPoints(Combatant c, StatBlock sb) {
    // A hand-set total is exact and is not scaled again: a DM who typed 40 meant
    // 40, and multiplying it by a scale they set earlier would give them 60.
    if (c.getMaxHitPoints() != null) {
      return c.getMaxHitPoints();
    }
    int base = sb != null && sb.getHitPoints() != null && sb.getHitPoints().getAverage() != null
        ? Math.max(1, sb.getHitPoints().getAverage())
        : 1;
    // Scaling is applied here and never written back, which is what lets a DM
    // dial a fight up, run it, dial it down and run it again.
    return c.getScaling() == null ? base : c.getScaling().hitPoints(base);
  }
}
