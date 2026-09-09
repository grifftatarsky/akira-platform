package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.Capability;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.model.GameCharacter;
import com.gpt.oozengine.model.creature.StatBlock;
import com.gpt.oozengine.model.dto.request.CombatantRequest;
import com.gpt.oozengine.model.dto.request.EncounterRequest;
import com.gpt.oozengine.model.dto.request.PaintRequest;
import com.gpt.oozengine.model.encounter.MapCell;
import com.gpt.oozengine.model.encounter.Scaling;
import com.gpt.oozengine.model.encounter.BattleMap;
import com.gpt.oozengine.repository.CharacterRepository;
import com.gpt.oozengine.repository.StatBlockRepository;
import com.gpt.oozengine.model.encounter.Combatant;
import com.gpt.oozengine.model.dto.response.CombatantResponse;
import com.gpt.oozengine.model.dto.response.EncounterResponse;
import com.gpt.oozengine.model.dto.response.EncounterSummaryResponse;
import com.gpt.oozengine.model.dto.response.StatBlockResponse;
import com.gpt.oozengine.model.encounter.Encounter;
import com.gpt.oozengine.repository.EncounterRepository;
import com.gpt.oozengine.util.Geometry;
import com.gpt.oozengine.util.Geometry.Footprint;
import com.gpt.oozengine.util.Geometry.Point;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
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
  private final StatBlockRepository statBlocks;
  private final CharacterRepository characters;

  /**
   * Summaries, mapped inside the transaction.
   *
   * <p>Returning entities and letting the controller map them reads the map
   * through a lazy proxy after the session has closed, which is a
   * LazyInitializationException rather than a list.
   */
  @Transactional(readOnly = true)
  public Page<EncounterSummaryResponse> list(UUID ownerId, Pageable pageable) {
    return repo.findByOwnerId(ownerId, pageable).map(EncounterSummaryResponse::from);
  }

  @Transactional(readOnly = true)
  public EncounterResponse view(UUID id, UUID ownerId) {
    return EncounterResponse.from(get(id, ownerId));
  }

  @Transactional
  public EncounterResponse createAndView(UUID ownerId, EncounterRequest req) {
    return EncounterResponse.from(create(ownerId, req));
  }

  @Transactional
  public EncounterResponse updateAndView(UUID id, UUID ownerId, EncounterRequest req) {
    return EncounterResponse.from(update(id, ownerId, req));
  }

  @Transactional
  public CombatantResponse placeAndView(UUID id, UUID ownerId, CombatantRequest req) {
    return CombatantResponse.from(place(id, ownerId, req));
  }

  @Transactional
  public CombatantResponse scaleAndView(UUID encounterId, UUID ownerId, UUID combatantId,
      Scaling scaling) {
    return CombatantResponse.from(scale(encounterId, ownerId, combatantId, scaling));
  }

  @Transactional
  public StatBlockResponse beginOverrideAndView(UUID encounterId, UUID ownerId,
      UUID combatantId) {
    return StatBlockResponse.from(beginOverride(encounterId, ownerId, combatantId));
  }

  @Transactional
  public CombatantResponse revertOverrideAndView(UUID encounterId, UUID ownerId,
      UUID combatantId) {
    return CombatantResponse.from(revertOverride(encounterId, ownerId, combatantId));
  }

  @Transactional
  public CombatantResponse updateCombatantAndView(
      UUID id, UUID ownerId, UUID combatantId, CombatantRequest req) {
    return CombatantResponse.from(updateCombatant(id, ownerId, combatantId, req));
  }

  /**
   * Paints a stroke onto the board.
   *
   * <p>Strokes rather than a whole canvas because a cave outlined wall by wall
   * is a few hundred requests, and because a stroke says what changed — a
   * repaint of the whole map cannot distinguish "I erased that wall" from "I did
   * not mention it".
   *
   * <p>Squares that end up matching the map's defaults are dropped rather than
   * stored, so erasing genuinely shrinks the board's storage instead of filling
   * it with rows that say nothing.
   */
  @Transactional
  public EncounterResponse paint(UUID id, UUID ownerId, List<PaintRequest> strokes) {
    Encounter e = get(id, ownerId);
    BattleMap map = e.getMap();
    Map<Long, MapCell> byPosition = new HashMap<>();
    map.getCells().forEach(c -> byPosition.put(positionKey(c.getX(), c.getY()), c));

    for (PaintRequest stroke : strokes) {
      if (Painter.needsBrush(stroke) && stroke.brush() == null) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
            "A stroke that is not an erase needs a brush");
      }
      for (Painter.Square sq : Painter.cover(stroke, map.getWidth(), map.getHeight())) {
        long key = positionKey(sq.x(), sq.y());
        if (stroke.erasing()) {
          byPosition.remove(key);
          continue;
        }
        MapCell cell = byPosition.computeIfAbsent(key, k -> EncounterMapper.blank(sq.x(), sq.y()));
        EncounterMapper.stamp(stroke.brush(), cell);
      }
    }

    // Rebuilt rather than mutated in place, and flushed between, for the same
    // reason a repaint is: Hibernate orders inserts ahead of deletes, so a
    // square that survives the stroke would collide with its own old row.
    var survivors = byPosition.values().stream().filter(c -> !EncounterMapper.isDefault(c)).toList();
    map.getCells().clear();
    repo.flush();
    map.getCells().addAll(survivors.stream().map(EncounterService::detachedCopy).toList());
    repo.flush();
    return EncounterResponse.from(e);
  }

  private static MapCell detachedCopy(MapCell c) {
    MapCell copy = EncounterMapper.blank(c.getX(), c.getY());
    copy.setElevationFeet(c.getElevationFeet());
    copy.setTerrain(c.getTerrain());
    copy.setLight(c.getLight());
    copy.setCover(c.getCover());
    copy.setOpaque(c.getOpaque());
    copy.setExtraMoveCostFeet(c.getExtraMoveCostFeet());
    copy.setNotes(c.getNotes());
    return copy;
  }

  private static long positionKey(int x, int y) {
    return ((long) x << 32) ^ (y & 0xffffffffL);
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
    // A default 20x20 board at 5 feet a square: a DM who wants to drop monsters
    // somewhere and think about terrain later should not have to describe a
    // board first.
    e.setMap(map == null ? new BattleMap() : map);
    return repo.save(e);
  }

  @Transactional
  public Encounter create(UUID ownerId, EncounterRequest req) {
    Encounter e = create(ownerId, req.name(), EncounterMapper.newMap(req.map()));
    e.setDescription(req.description());
    return e;
  }

  /** Renames, re-describes, and repaints. Combatants are edited separately. */
  @Transactional
  public Encounter update(UUID id, UUID ownerId, EncounterRequest req) {
    Encounter e = get(id, ownerId);
    e.setName(req.name());
    e.setDescription(req.description());
    EncounterMapper.applyScalars(req.map(), e.getMap());
    if (req.map() != null && req.map().cells() != null) {
      var repainted = EncounterMapper.cellsFrom(req.map(), e.getMap());
      // Hibernate orders inserts ahead of deletes within a flush, so repainting
      // a square that was already painted collides on uq_map_cells_position.
      // Flushing between makes the delete land first.
      e.getMap().getCells().clear();
      repo.flush();
      e.getMap().getCells().addAll(repainted);
    }
    repo.flush();
    return e;
  }

  /**
   * Places a combatant described by a request, resolving its base.
   *
   * <p>The base is looked up rather than trusted: a request naming a stat block
   * that does not exist should fail here, not when the engine tries to execute
   * a null creature three turns into a battle.
   */
  @Transactional
  public Combatant place(UUID encounterId, UUID ownerId, CombatantRequest req) {
    Combatant c = new Combatant();
    EncounterMapper.apply(req, c, resolveStatBlock(req), resolveCharacter(req, ownerId));
    return place(encounterId, ownerId, c);
  }

  @Transactional
  public Combatant updateCombatant(
      UUID encounterId, UUID ownerId, UUID combatantId, CombatantRequest req) {
    Encounter e = get(encounterId, ownerId);
    Combatant c = combatant(e, combatantId);
    int x = c.getX();
    int y = c.getY();
    int z = c.getZ();
    EncounterMapper.apply(req, c, resolveStatBlock(req), resolveCharacter(req, ownerId));
    try {
      requireClear(e, c);
    } catch (ResponseStatusException ex) {
      c.setX(x);
      c.setY(y);
      c.setZ(z);
      throw ex;
    }
    repo.flush();
    return c;
  }

  /**
   * Dials a creature up or down without touching the compendium or cloning it.
   *
   * <p>The descriptor is stored, not the result: "half again as tough" survives
   * as {@code hitPointPercent = 150} and can be turned back down a month later,
   * where a cloned block with 11 written over 7 cannot say whether that 11 was a
   * scale or a hand edit.
   */
  @Transactional
  public Combatant scale(UUID encounterId, UUID ownerId, UUID combatantId, Scaling scaling) {
    Encounter e = get(encounterId, ownerId);
    Combatant c = combatant(e, combatantId);
    c.setScaling(scaling == null ? new Scaling() : scaling);
    repo.flush();
    return c;
  }

  /**
   * Gives this one token a private copy of its stat block to edit.
   *
   * <p>Copy-on-write, and the write is the point: nothing is cloned until a DM
   * actually changes the creature, so an encounter full of goblins is one shared
   * row and not forty copies of it.
   *
   * <p>Idempotent — asking twice returns the copy that already exists rather
   * than making a second one and losing the first edit.
   */
  @Transactional
  public StatBlock beginOverride(UUID encounterId, UUID ownerId, UUID combatantId) {
    Encounter e = get(encounterId, ownerId);
    Combatant c = combatant(e, combatantId);
    if (c.getPrivateStatBlock() != null) {
      return c.getPrivateStatBlock();
    }
    StatBlock base = c.getStatBlock() != null ? c.getStatBlock()
        : c.getGameCharacter() != null ? c.getGameCharacter().getStatBlock() : null;
    if (base == null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT,
          "This combatant has no stat block to override");
    }
    c.setPrivateStatBlock(StatBlockCloner.deepCopy(base));
    repo.flush();
    return c.getPrivateStatBlock();
  }

  /**
   * Throws the private copy away and goes back to the book.
   *
   * <p>orphanRemoval on the association does the deleting, so reverting cannot
   * leave an override row that nothing points at and nobody will ever find.
   */
  @Transactional
  public Combatant revertOverride(UUID encounterId, UUID ownerId, UUID combatantId) {
    Encounter e = get(encounterId, ownerId);
    Combatant c = combatant(e, combatantId);
    c.setPrivateStatBlock(null);
    repo.flush();
    return c;
  }

  @Transactional
  public void removeCombatant(UUID encounterId, UUID ownerId, UUID combatantId) {
    Encounter e = get(encounterId, ownerId);
    e.getCombatants().remove(combatant(e, combatantId));
    repo.flush();
  }

  private StatBlock resolveStatBlock(CombatantRequest req) {
    if (req.statBlockId() == null) {
      return null;
    }
    return statBlocks.findById(req.statBlockId())
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
            "No stat block " + req.statBlockId()));
  }

  private GameCharacter resolveCharacter(CombatantRequest req, UUID ownerId) {
    if (req.gameCharacterId() == null) {
      return null;
    }
    GameCharacter c = characters.findById(req.gameCharacterId())
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
            "No character " + req.gameCharacterId()));
    // Characters are private, so placing someone else's is a not-found rather
    // than a forbidden — the same rule the encounter itself follows.
    if (!ownerId.equals(c.getOwnerId())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "No character " + req.gameCharacterId());
    }
    return c;
  }

  private static Combatant combatant(Encounter e, UUID id) {
    return e.getCombatants().stream()
        .filter(x -> x.getId().equals(id))
        .findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
            "No combatant " + id));
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
      throw new ResponseStatusException(HttpStatus.CONFLICT,
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
    Combatant c = combatant(e, combatantId);
    int x = c.getX();
    int y = c.getY();
    int z = c.getZ();
    c.setX(to.x());
    c.setY(to.y());
    c.setZ(to.z());
    try {
      requireClear(e, c);
    } catch (ResponseStatusException ex) {
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
      // A conflict, not a bad request: the body was fine, the board disagreed.
      throw new ResponseStatusException(HttpStatus.CONFLICT, "That space is occupied");
    }
  }

  /**
   * The size actually in effect: the combatant's override if it has one, else
   * its base's. Usually the base's, so a response that returned the override
   * would report null for almost every token on the board.
   */
  public static CreatureSize sizeOf(Combatant c) {
    if (c.getSize() != null) {
      return c.getSize();
    }
    if (c.getStatBlock() != null && c.getStatBlock().getSize() != null) {
      return c.getStatBlock().getSize();
    }
    if (c.getGameCharacter() != null && c.getGameCharacter().getStatBlock() != null
        && c.getGameCharacter().getStatBlock().getSize() != null) {
      return c.getGameCharacter().getStatBlock().getSize();
    }
    return CreatureSize.MEDIUM;
  }

  public static Footprint footprintOf(Combatant c) {
    return Footprint.of(new Point(c.getX(), c.getY(), c.getZ()), sizeOf(c));
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

  /**
   * Not found rather than forbidden, deliberately: an encounter is a plan for a
   * session, and a stranger should not learn that a given id exists.
   */
  private static ResponseStatusException notFound(UUID id) {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "No encounter " + id);
  }

  /** Chebyshev distance between two placed combatants, edge to edge, in feet. */
  public static double separationFeet(Combatant a, Combatant b) {
    return Geometry.toFeet(Geometry.separation(footprintOf(a), footprintOf(b)));
  }
}
