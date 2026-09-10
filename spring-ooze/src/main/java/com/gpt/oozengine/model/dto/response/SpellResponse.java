package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.MagicSchool;
import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.model.Spell;
import java.util.UUID;

/**
 * A spell as seen by a caller. {@code base} marks shared 5e content (read-only
 * for the user — editing copy-on-writes). When {@code base} is false the row
 * belongs to the requester; {@code overridesId} non-null means it's their
 * modified copy of that base spell (so the UI can offer "revert").
 */
public record SpellResponse(
    UUID id,
    String name,
    int level,
    MagicSchool school,
    String castingTime,
    String range,
    String duration,
    boolean concentration,
    boolean ritual,
    boolean verbalComponent,
    boolean somaticComponent,
    boolean materialComponent,
    String materials,
    String description,
    String atHigherLevels,
    boolean base,
    UUID overridesId,
    SrdVersion srdVersion) {

  public static SpellResponse from(Spell s) {
    return new SpellResponse(
        s.getId(),
        s.getName(),
        s.getLevel(),
        s.getSchool(),
        s.getCastingTime(),
        s.getRange(),
        s.getDuration(),
        s.isConcentration(),
        s.isRitual(),
        s.isVerbalComponent(),
        s.isSomaticComponent(),
        s.isMaterialComponent(),
        s.getMaterials(),
        s.getDescription(),
        s.getAtHigherLevels(),
        s.isBaseContent(),
        s.getOverridesId(),
        s.getSrdVersion());
  }
}
