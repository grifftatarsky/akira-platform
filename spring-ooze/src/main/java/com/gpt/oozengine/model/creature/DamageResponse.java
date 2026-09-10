package com.gpt.oozengine.model.creature;

import com.gpt.oozengine.constant.rules.DamageResponseKind;
import com.gpt.oozengine.constant.rules.DamageType;
import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * How a creature answers one damage type. Split per type rather than stored as
 * the book's comma list so the simulator can halve, zero, or double a damage
 * roll without re-reading prose.
 *
 * <p>{@link #qualifier} carries the awkward cases the type alone can't —
 * "from nonmagical attacks", "while in dim light" — which are real and are not
 * worth a second enum.
 */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class DamageResponse {

  @Enumerated(EnumType.STRING)
  @Column(name = "damage_type", nullable = false, length = 16)
  private DamageType damageType;

  @Enumerated(EnumType.STRING)
  @Column(name = "response", nullable = false, length = 16)
  private DamageResponseKind response;

  @Column(name = "qualifier")
  private String qualifier;
}
