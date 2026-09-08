package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.UsesReset;
import com.gpt.oozengine.model.creature.KnownSpell;
import java.util.UUID;

/**
 * A spell a creature can cast, and on what allowance.
 *
 * <p>Monster spellcasting is not a spell list plus slots — it is "At Will:
 * Detect Magic" and "1/Day Each: Finger of Death" — so the allowance travels
 * with the spell rather than being derived from a level table.
 *
 * @param spellLevel the level it is cast at, which the book sometimes raises
 * @param baseLevel the spell's own level, so a raise can be told from the
 *     ordinary case — the book annotates one and not the other
 */
public record KnownSpellResponse(
    UUID spellId,
    String spellName,
    int spellLevel,
    int baseLevel,
    UsesReset usesReset,
    Integer usesMax) {

  public static KnownSpellResponse from(KnownSpell k) {
    return new KnownSpellResponse(
        k.getSpell().getId(), k.getSpell().getName(), k.getSpellLevel(),
        k.getSpell().getLevel(), k.getUsesReset(), k.getUsesMax());
  }
}
