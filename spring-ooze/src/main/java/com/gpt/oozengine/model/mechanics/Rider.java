package com.gpt.oozengine.model.mechanics;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.DamageType;
import com.gpt.oozengine.constant.rules.RiderMode;
import com.gpt.oozengine.constant.rules.RiderTarget;
import com.gpt.oozengine.constant.rules.TimeUnit;
import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A standing modifier to some roll or value — the book's third mechanical voice.
 *
 * <p>Damage and conditions were the only two the model had, and between them
 * they cannot say "Pack Tactics: Advantage on an attack roll if an ally is
 * within 5 feet of the target", which is the single most common thing a monster
 * does that is neither. 303 passive traits and a further 15 actions were
 * therefore mechanically invisible: a Pack Tactics creature attacked as though
 * it were alone, and Slowing Breath did nothing whatsoever.
 *
 * <p><b>Why its own table rather than columns on {@link Effect}.</b> One effect
 * routinely grants several. The white dragon's Slowing Breath, on one Failure,
 * denies Reactions, halves Speed and caps the target's attacks — three riders,
 * one clause. Six nullable columns on {@code effects} could hold one of those.
 *
 * <p><b>Why the gate is prose.</b> {@link #gate} carries the book's own
 * condition verbatim ("while in sunlight", "if an ally is within 5 feet of the
 * target"). Machine-checking every gate would need a rules language; showing the
 * DM the words and letting them say yes is the same bargain the rest of the
 * engine makes, and it is honest about which half the computer is good at.
 */
@Entity
@Table(name = "riders")
@Getter
@Setter
@NoArgsConstructor
public class Rider extends BaseEntity {

  /** Read-only mirror of the owning column, so the engine can query riders directly. */
  @Column(name = "effect_id", insertable = false, updatable = false)
  private UUID effectId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 24)
  private RiderTarget target;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private RiderMode mode;

  /** For {@link RiderMode#BONUS}: the flat amount, negative for a penalty. */
  private Integer amount;

  /** For a rolled modifier — "subtracts 3 (1d6) from its damage rolls". */
  @Embedded
  private DiceRoll amountDice;

  /** Narrows the target: Disadvantage on <em>Strength-based</em> D20 Tests. */
  @Enumerated(EnumType.STRING)
  @Column(length = 16)
  private Ability ability;

  /** Narrows the target: resistance-style riders that name a damage type. */
  @Enumerated(EnumType.STRING)
  @Column(name = "damage_type", length = 16)
  private DamageType damageType;

  /** The book's own precondition, shown to the DM rather than evaluated. */
  @Column(columnDefinition = "text")
  private String gate;

  @Column(name = "duration_amount")
  private Integer durationAmount;

  @Enumerated(EnumType.STRING)
  @Column(name = "duration_unit", length = 16)
  private TimeUnit durationUnit;

  /**
   * What lifts this early, when the book names something specific — the rust
   * monster's corrosion says "The penalty can be removed by casting the Mending
   * spell." Held as the spell's name so the engine can offer the removal when
   * that spell is cast on the item, rather than waiting for a duration that
   * never comes.
   */
  @Column(name = "removed_by", length = 64)
  private String removedBy;

  /**
   * When the accumulated penalty destroys what it is attached to: armor at AC
   * 10, a weapon at -5. Null for riders that never destroy anything.
   */
  @Column(name = "destroyed_at")
  private Integer destroyedAt;
}
