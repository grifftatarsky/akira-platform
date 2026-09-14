package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.model.encounter.Scaling;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * How far from the book to dial a creature.
 *
 * <p>Percentages where 100 is the book, deltas where 0 is. Every field boxed and
 * optional, so a request that only toughens a creature does not have to restate
 * the four things it is leaving alone.
 */
public record ScalingRequest(
    @Min(1) @Max(1000) Integer hitPointPercent,
    Integer armorClassDelta,
    @Min(1) @Max(1000) Integer damagePercent,
    Integer attackBonusDelta,
    Integer saveDcDelta) {

  public Scaling toScaling() {
    return new Scaling(
        hitPointPercent == null ? 100 : hitPointPercent,
        armorClassDelta == null ? 0 : armorClassDelta,
        damagePercent == null ? 100 : damagePercent,
        attackBonusDelta == null ? 0 : attackBonusDelta,
        saveDcDelta == null ? 0 : saveDcDelta);
  }
}
