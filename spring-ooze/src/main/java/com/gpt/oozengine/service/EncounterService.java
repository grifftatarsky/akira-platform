package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.Capability;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.model.encounter.BattleMap;
import com.gpt.oozengine.model.encounter.Combatant;
import com.gpt.oozengine.model.encounter.Encounter;
import com.gpt.oozengine.repository.EncounterRepository;
import com.gpt.oozengine.util.Geometry;
import com.gpt.oozengine.util.Geometry.Footprint;
import com.gpt.oozengine.util.Geometry.Point;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Building and editing an encounter.
 *
 * <p>Ownership is enforced here rather than with {@code @PreAuthorize}, matching
 * the rest of the codebase: no authority grants you your own encounters, so the
 * rule is a row-level one and belongs in the service.
 */
@Service
@RequiredArgsConstructor
public class EncounterService {

  /** A usability guardrail, not a technical limit — past this an initiative order stops working. */
  public static final int MAX_COMBATANTS = 40;

  private final EncounterRepository repo;

  @Transactional(readOnly = true)
  public Page<Encounter> list(UUID ownerId, Pageable pageable) {
    return repo.findByOwnerId(ownerId, pageable);
  }

  @Transactional(readOnly = true)
  public Encounter get(UUID id, UUID ownerId) {
    Encounter e = repo.findWithBoardById(id).orElseThrow(() -> notFound(id));
    if (!e.getOwnerId().equals(ownerId)) {
      throw notFound(id);
    }
    return e;
  }

  @Transactional
  public Encounter create(UUID ownerId, String name, BattleMap map) {
    Encounter e = new Encounter();
    e.setOwnerId(ownerId);
    e.setName(name);
    e.setMap(map == null ? new BattleMap() : map);
    return repo.save(e);
  }

  @Transactional
  public void delete(UUID id, UUID ownerId) {
    repo.delete(get(id, ownerId));
  }

  /**
   * Places a combatant, refusing a spot where it would overlap someone.
   *
   * <p>The refusal is the point. Two tokens in one space is not a rendering
   * glitch to tidy up later — it makes reach, cover and movement cost all answer
   * wrongly, because every one of them measures from a footprint.
   *
   * @throws IllegalStateException if the space is taken, or the roster is full
   */
  @Transactional
  public Combatant place(UUID encounterId, UUID ownerId, Combatant combatant) {
    Encounter e = get(encounterId, ownerId);
    if (e.getCombatants().size() >= MAX_COMBATANTS) {
      throw new IllegalStateException(
          "An encounter holds at most " + MAX_COMBATANTS + " combatants");
    }
    requireClear(e, combatant);
    e.addCombatant(combatant);
    // Flushed, never saved. `e` is already managed, so save() calls merge(),
    // and merge cascades into the collection by persisting a *copy* of the new
    // combatant — leaving the instance we return detached with a null id, which
    // the caller then cannot move or remove. Dirty checking already has the
    // change; flush only decides when it lands.
    repo.flush();
    return combatant;
  }

  /** Moves a placed combatant, with the same overlap rule. */
  @Transactional
  public Combatant moveTo(UUID encounterId, UUID ownerId, UUID combatantId, Point to) {
    Encounter e = get(encounterId, ownerId);
    Combatant c = e.getCombatants().stream()
        .filter(x -> x.getId().equals(combatantId))
        .findFirst()
        .orElseThrow(() -> new IllegalArgumentException("No combatant " + combatantId));
    int x = c.getX();
    int y = c.getY();
    int z = c.getZ();
    c.setX(to.x());
    c.setY(to.y());
    c.setZ(to.z());
    try {
      requireClear(e, c);
    } catch (IllegalStateException ex) {
      // Put it back, so a refused move leaves the board exactly as it was rather
      // than half-applied.
      c.setX(x);
      c.setY(y);
      c.setZ(z);
      throw ex;
    }
    repo.flush();
    return c;
  }

  private void requireClear(Encounter e, Combatant moving) {
    Battlefield field = new Battlefield(e.getMap(), e.getMap().getCells());
    List<Footprint> others = new ArrayList<>();
    List<Set<Capability>> theirCapabilities = new ArrayList<>();
    for (Combatant other : e.getCombatants()) {
      if (other == moving || other.getId() != null && other.getId().equals(moving.getId())) {
        continue;
      }
      others.add(footprintOf(other));
      theirCapabilities.add(capabilitiesOf(other));
    }
    if (!field.canStand(footprintOf(moving), capabilitiesOf(moving), others, theirCapabilities)) {
      throw new IllegalStateException("That space is occupied");
    }
  }

  /** Size comes from the combatant's override, else its base stat block. */
  public static Footprint footprintOf(Combatant c) {
    CreatureSize size = c.getSize();
    if (size == null && c.getStatBlock() != null) {
      size = c.getStatBlock().getSize();
    }
    if (size == null && c.getGameCharacter() != null
        && c.getGameCharacter().getStatBlock() != null) {
      size = c.getGameCharacter().getStatBlock().getSize();
    }
    return Footprint.of(new Point(c.getX(), c.getY(), c.getZ()),
        size == null ? CreatureSize.MEDIUM : size);
  }

  /**
   * What the creature's traits permit. Read off its features, so a swarm's
   * licence to share a square comes from the same import as everything else.
   */
  public static Set<Capability> capabilitiesOf(Combatant c) {
    var statBlock = c.getStatBlock() != null ? c.getStatBlock()
        : c.getGameCharacter() != null ? c.getGameCharacter().getStatBlock() : null;
    if (statBlock == null) {
      return Set.of();
    }
    Set<Capability> out = EnumSet.noneOf(Capability.class);
    statBlock.getFeatures()
        .forEach(f -> f.getCapabilities().forEach(fc -> out.add(fc.getCapability())));
    return out;
  }

  private static IllegalArgumentException notFound(UUID id) {
    return new IllegalArgumentException("No encounter " + id);
  }

  /** Chebyshev distance between two placed combatants, edge to edge, in feet. */
  public static double separationFeet(Combatant a, Combatant b) {
    return Geometry.toFeet(Geometry.separation(footprintOf(a), footprintOf(b)));
  }
}
