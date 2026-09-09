package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.Capability;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.Disposition;
import com.gpt.oozengine.model.encounter.Combatant;
import com.gpt.oozengine.service.EncounterService;
import java.util.List;
import java.util.UUID;

/**
 * A placed token.
 *
 * <p>Carries the resolved {@link #size} and {@link #spaceHalfFeet} rather than
 * making the client work them out: the footprint decides reach, cover and who
 * may stand where, and a client that computed it from a different rule than the
 * server would draw a board the server disagrees with.
 *
 * <p>{@link #capabilities} is here for the same reason. A swarm may share a
 * square, and the board needs to know that before the DM drags something onto
 * it — not after the server refuses.
 */
public record CombatantResponse(
    UUID id,
    UUID statBlockId,
    UUID gameCharacterId,
    String name,
    int xHalfFeet,
    int yHalfFeet,
    int zHalfFeet,
    Disposition disposition,
    boolean surprised,
    Integer maxHitPoints,
    CreatureSize size,
    int spaceHalfFeet,
    List<Capability> capabilities,
    /** True when this token carries a private, edited copy of its stat block. */
    boolean overridden,
    ScalingResponse scaling,
    String notes) {

  /** How far from the book this creature is dialled; nulls where it is not. */
  public record ScalingResponse(
      int hitPointPercent,
      int armorClassDelta,
      int damagePercent,
      int attackBonusDelta,
      int saveDcDelta,
      boolean unchanged) {}

  public static CombatantResponse from(Combatant c) {
    var footprint = EncounterService.footprintOf(c);
    return new CombatantResponse(
        c.getId(),
        c.getStatBlock() == null ? null : c.getStatBlock().getId(),
        c.getGameCharacter() == null ? null : c.getGameCharacter().getId(),
        c.getName(),
        c.getX(), c.getY(), c.getZ(),
        c.getDisposition(),
        c.isSurprised(),
        c.getMaxHitPoints(),
        EncounterService.sizeOf(c),
        footprint.spaceHalfFeet(),
        List.copyOf(EncounterService.capabilitiesOf(c)),
        c.isOverridden(),
        scalingOf(c),
        c.getNotes());
  }

  private static ScalingResponse scalingOf(Combatant c) {
    var s = c.getScaling() == null ? new com.gpt.oozengine.model.encounter.Scaling()
        : c.getScaling();
    return new ScalingResponse(s.getHitPointPercent(), s.getArmorClassDelta(),
        s.getDamagePercent(), s.getAttackBonusDelta(), s.getSaveDcDelta(), s.isUnchanged());
  }
}
