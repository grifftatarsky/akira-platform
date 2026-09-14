package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.Alignment;
import com.gpt.oozengine.model.GameCharacter;
import java.util.UUID;

/**
 * A character for the caller. Characters are always user-owned, so {@code base}
 * is always false and {@code overridesId} always null — that shape lets the
 * generic finder/panel treat them as the caller's own creations (edit/delete,
 * no hide/revert).
 *
 * <p>Species, class and background are foreign keys now, so both the id and the
 * name travel: the id is what an editor writes back, the name is what the finder
 * shows without a second request.
 */
public record CharacterResponse(
    UUID id,
    String name,
    String kind,
    UUID speciesId,
    String species,
    UUID vocationId,
    String characterClass,
    UUID subclassId,
    String subclass,
    UUID backgroundId,
    String background,
    Alignment alignment,
    Integer level,
    Integer armorClass,
    Integer hitPointsAverage,
    Integer strength,
    Integer dexterity,
    Integer constitution,
    Integer intelligence,
    Integer wisdom,
    Integer charisma,
    StatBlockResponse statBlock,
    String description,
    String notes,
    boolean base,
    UUID overridesId) {

  public static CharacterResponse from(GameCharacter c) {
    var s = c.getStatBlock();
    return new CharacterResponse(
        c.getId(),
        c.getName(),
        c.getKind() == null ? null : c.getKind().name(),
        c.getSpecies() == null ? null : c.getSpecies().getId(),
        c.getSpecies() == null ? null : c.getSpecies().getName(),
        c.getVocation() == null ? null : c.getVocation().getId(),
        c.getVocation() == null ? null : c.getVocation().getName(),
        c.getSubclass() == null ? null : c.getSubclass().getId(),
        c.getSubclass() == null ? null : c.getSubclass().getName(),
        c.getBackground() == null ? null : c.getBackground().getId(),
        c.getBackground() == null ? null : c.getBackground().getName(),
        s == null ? null : s.getAlignment(),
        c.getLevel(),
        s == null ? null : s.getArmorClass(),
        s == null || s.getHitPoints() == null ? null : s.getHitPoints().getAverage(),
        s == null ? null : s.getStrength(),
        s == null ? null : s.getDexterity(),
        s == null ? null : s.getConstitution(),
        s == null ? null : s.getIntelligence(),
        s == null ? null : s.getWisdom(),
        s == null ? null : s.getCharisma(),
        StatBlockResponse.from(s),
        c.getDescription(),
        c.getNotes(),
        false,
        null);
  }
}
