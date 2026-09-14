package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.model.GameCharacter;
import com.gpt.oozengine.model.creature.StatBlock;
import com.gpt.oozengine.model.dto.request.CharacterRequest;
import com.gpt.oozengine.model.dto.response.CharacterResponse;
import com.gpt.oozengine.model.mechanics.DiceRoll;
import com.gpt.oozengine.repository.BackgroundRepository;
import com.gpt.oozengine.repository.CharacterRepository;
import com.gpt.oozengine.repository.SpeciesRepository;
import com.gpt.oozengine.repository.SubclassRepository;
import com.gpt.oozengine.repository.VocationRepository;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * User-scoped characters. Each user only ever sees and edits their own — there
 * is no shared base content, so this doesn't use the override machinery.
 */
@Service
@RequiredArgsConstructor
public class CharacterService {

  private final CharacterRepository characters;
  private final SpeciesRepository species;
  private final VocationRepository vocations;
  private final SubclassRepository subclasses;
  private final BackgroundRepository backgrounds;

  @Transactional(readOnly = true)
  public List<CharacterResponse> list(UUID userId) {
    if (userId == null) {
      return List.of();
    }
    return characters.findByOwnerIdOrderByNameAsc(userId).stream()
        .map(CharacterResponse::from)
        .toList();
  }

  @Transactional(readOnly = true)
  public CharacterResponse get(UUID id, UUID userId) {
    return CharacterResponse.from(owned(id, userId));
  }

  @Transactional
  public CharacterResponse create(CharacterRequest req, UUID userId) {
    GameCharacter c = new GameCharacter();
    apply(req, c);
    c.setOwnerId(userId);
    return CharacterResponse.from(characters.save(c));
  }

  @Transactional
  public CharacterResponse update(UUID id, CharacterRequest req, UUID userId) {
    GameCharacter c = owned(id, userId);
    apply(req, c);
    return CharacterResponse.from(characters.save(c));
  }

  @Transactional
  public void delete(UUID id, UUID userId) {
    characters.delete(owned(id, userId));
  }

  /** Fetch a character the caller owns, or 404 (also hides others' rows). */
  private GameCharacter owned(UUID id, UUID userId) {
    GameCharacter c =
        characters
            .findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Character not found"));
    if (userId == null || !userId.equals(c.getOwnerId())) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Character not found");
    }
    return c;
  }

  private void apply(CharacterRequest r, GameCharacter c) {
    c.setName(r.name());
    c.setKind(r.kind());
    c.setLevel(r.level());
    c.setDescription(r.description());
    c.setNotes(r.notes());
    c.setSpecies(ref(species, r.speciesId()));
    c.setVocation(ref(vocations, r.vocationId()));
    c.setSubclass(ref(subclasses, r.subclassId()));
    c.setBackground(ref(backgrounds, r.backgroundId()));

    StatBlock s = c.getStatBlock();
    if (s == null) {
      s = new StatBlock();
      c.setStatBlock(s);
    }
    s.setAlignment(r.alignment());
    s.setArmorClass(r.armorClass());
    s.setHitPoints(new DiceRoll(null, null, null, r.hitPointsAverage()));
    if (r.walkSpeed() == null || r.walkSpeed() <= 0) {
      s.getSpeeds().remove(MovementType.WALK);
    } else {
      s.getSpeeds().put(MovementType.WALK, r.walkSpeed());
    }
    s.setStrength(r.strength());
    s.setDexterity(r.dexterity());
    s.setConstitution(r.constitution());
    s.setIntelligence(r.intelligence());
    s.setWisdom(r.wisdom());
    s.setCharisma(r.charisma());
  }

  /** Resolves an optional foreign key, tolerating an id that no longer exists. */
  private static <T> T ref(org.springframework.data.jpa.repository.JpaRepository<T, UUID> repo, UUID id) {
    return id == null ? null : repo.findById(id).orElse(null);
  }
}
