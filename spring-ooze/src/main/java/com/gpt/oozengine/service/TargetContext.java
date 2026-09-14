package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.CoverDegree;
import java.util.UUID;

/**
 * What the board says about one target, at the moment of an attack.
 *
 * <p><b>Passed in rather than looked up.</b> Resolution needs range and cover,
 * and the tracker is not allowed to know what a map is — so whoever has a board
 * computes these and hands them over, and a tracker used at a table without one
 * passes {@link #open}. That keeps the boundary intact while letting resolution
 * live beside the log it writes to.
 *
 * @param coverArmorClassBonus from the glossary: Half Cover is +2 and
 *     Three-Quarters is +5, "to AC and Dexterity saving throws"
 * @param totalCover "can't be targeted directly" — a refusal, not a penalty
 */
public record TargetContext(
    UUID participantId,
    int coverArmorClassBonus,
    boolean totalCover,
    boolean inRange,
    boolean hasLineOfSight) {

  /** Nothing in the way, which is what a tracker without a board assumes. */
  public static TargetContext open(UUID participantId) {
    return new TargetContext(participantId, 0, false, true, true);
  }

  public static TargetContext of(UUID participantId, CoverDegree cover, boolean inRange) {
    return new TargetContext(participantId, cover.armorClassBonus(), cover.blocksTargeting(),
        inRange, !cover.blocksTargeting());
  }

  /** Whether an attack may be made at all. */
  public boolean targetable() {
    return inRange && hasLineOfSight && !totalCover;
  }
}
