package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.model.Monster;
import java.util.UUID;

/**
 * A bestiary entry.
 *
 * <p>Carries the structured {@link StatBlockResponse} for anything that needs to
 * reason about the creature, and a handful of flattened fields for the finder's
 * generic detail pane, which renders label/value pairs rather than a stat block.
 * The flat fields are derived, never stored — they cannot drift from the block.
 */
public record MonsterResponse(
    UUID id,
    String name,
    String description,
    String size,
    String creatureType,
    String alignment,
    Integer armorClass,
    String hitPoints,
    String speed,
    String challengeRating,
    Integer strength,
    Integer dexterity,
    Integer constitution,
    Integer intelligence,
    Integer wisdom,
    Integer charisma,
    StatBlockResponse statBlock,
    boolean base,
    UUID overridesId,
    SrdVersion srdVersion) {

  /** Without the stat block: what a list row needs, and nothing more. */
  public static MonsterResponse summary(Monster m) {
    return build(m, false);
  }

  public static MonsterResponse from(Monster m) {
    return build(m, true);
  }

  private static MonsterResponse build(Monster m, boolean withStatBlock) {
    var s = m.getStatBlock();
    var block = withStatBlock ? StatBlockResponse.from(s) : null;
    String hp =
        s == null || s.getHitPoints() == null
            ? null
            : s.getHitPoints().getAverage()
                + (s.getHitPoints().isFlat() ? "" : " (" + s.getHitPoints().expression() + ")");
    String speed =
        s == null || s.getSpeeds().isEmpty()
            ? null
            : s.getSpeeds().entrySet().stream()
                .map(e -> e.getKey().name().charAt(0) + e.getKey().name().substring(1).toLowerCase()
                    + " " + e.getValue() + " ft.")
                .reduce((a, b) -> a + ", " + b)
                .orElse(null);
    return new MonsterResponse(
        m.getId(),
        m.getName(),
        m.getDescription(),
        s == null || s.getSize() == null ? null : s.getSize().name(),
        s == null || s.getCreatureType() == null ? null : s.getCreatureType().name(),
        s == null || s.getAlignment() == null ? null : s.getAlignment().name(),
        s == null ? null : s.getArmorClass(),
        hp,
        speed,
        s == null || s.getChallengeRating() == null
            ? null
            : s.getChallengeRating().stripTrailingZeros().toPlainString(),
        s == null ? null : s.getStrength(),
        s == null ? null : s.getDexterity(),
        s == null ? null : s.getConstitution(),
        s == null ? null : s.getIntelligence(),
        s == null ? null : s.getWisdom(),
        s == null ? null : s.getCharisma(),
        block,
        m.isBaseContent(),
        m.getOverridesId(),
        m.getSrdVersion());
  }
}
