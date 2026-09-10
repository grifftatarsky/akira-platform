package com.gpt.oozengine.model.mechanics;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.DamageType;
import com.gpt.oozengine.constant.rules.EffectKind;
import com.gpt.oozengine.constant.rules.EffectOutcome;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.constant.rules.TimeUnit;
import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.CascadeType;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import org.hibernate.annotations.BatchSize;
import java.util.ArrayList;
import java.util.List;
import com.gpt.oozengine.model.Condition;
import jakarta.persistence.AttributeOverride;
import jakarta.persistence.Column;
import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One consequence of a {@link FeatureStep}, attached to the branch that
 * produces it.
 *
 * <p>A feature can have several: the Aboleth's Tentacle deals damage on a hit
 * <em>and</em> applies Grappled on the same hit, which is two rows sharing
 * {@link EffectOutcome#HIT}. A saving-throw feature typically has one row at
 * {@link EffectOutcome#SAVE_FAILURE} and, where the book says "Success: Half
 * damage", one at {@link EffectOutcome#SAVE_SUCCESS} with {@link #halfDamage}
 * set rather than a second dice expression — halving is a rule, not a different
 * roll, and writing it as data would let the two drift.
 *
 * <p>The simulator reads {@link #kind} to decide what to do and never reads
 * {@link #notes}; {@link #notes} is for the residue of a sentence that carries
 * more than the columns can, so that no information from the book is discarded
 * on import.
 */
@Entity
@Table(name = "effects")
@Getter
@Setter
@NoArgsConstructor
public class Effect extends BaseEntity {

  /** Which branch of the parent feature's resolution this belongs to. */
  /** Read-only mirror of the owning column, for queries that skip the aggregate. */
  @Column(name = "step_id", insertable = false, updatable = false)
  private java.util.UUID stepId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 24)
  private EffectOutcome outcome = EffectOutcome.ALWAYS;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 28)
  private EffectKind kind;

  @Column(nullable = false)
  private int ordinal;

  // region Amount — damage, healing, temporary hit points
  @Embedded
  @AttributeOverride(name = "count", column = @Column(name = "dice_count"))
  @AttributeOverride(name = "faces", column = @Column(name = "dice_faces"))
  @AttributeOverride(name = "bonus", column = @Column(name = "dice_bonus"))
  @AttributeOverride(name = "average", column = @Column(name = "dice_average"))
  private DiceRoll amount;

  @Enumerated(EnumType.STRING)
  @Column(name = "damage_type", length = 16)
  private DamageType damageType;

  /** True where the book says "Success: Half damage" — no second amount is stored. */
  @Column(name = "half_damage", nullable = false)
  private boolean halfDamage;
  // endregion

  // region Condition applied or removed
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "condition_id")
  private Condition condition;

  /** Escape DC for Grappled and Restrained, where the target breaks out with a check. */
  @Column(name = "escape_dc")
  private Integer escapeDc;

  /** Ability for a repeated save to shake the condition off, if the book grants one. */
  @Enumerated(EnumType.STRING)
  @Column(name = "repeat_save_ability", length = 16)
  private Ability repeatSaveAbility;

  @Column(name = "duration_amount")
  private Integer durationAmount;

  @Enumerated(EnumType.STRING)
  @Column(name = "duration_unit", length = 16)
  private TimeUnit durationUnit;
  // endregion

  // region Movement — pushes, pulls, teleports
  @Enumerated(EnumType.STRING)
  @Column(name = "movement_type", length = 16)
  private MovementType movementType;

  /** Positive pushes away from the source, negative pulls toward it. */
  @Column(name = "movement_feet")
  private Integer movementFeet;
  // endregion

  /** Anything the columns above can't carry, kept verbatim so nothing is lost. */
  @Column(columnDefinition = "text")
  private String notes;

  /**
   * Modifiers this effect grants or imposes. Usually empty; several at once for
   * a clause like Slowing Breath's, which denies Reactions, halves Speed and
   * caps attacks in one Failure.
   */
  @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  @JoinColumn(name = "effect_id", nullable = false)
  @OrderBy("id ASC")
  @BatchSize(size = 64)
  private List<Rider> riders = new ArrayList<>();

  /** For {@link com.gpt.oozengine.constant.rules.EffectKind#SUMMON}: what appears. */
  @Column(name = "summon_stat_block_id")
  private java.util.UUID summonStatBlockId;

  /** How many appear, and at most how many the summoner may control at once. */
  @Column(name = "summon_count")
  private Integer summonCount;

  @Column(name = "summon_max_controlled")
  private Integer summonMaxControlled;

  public void addRider(Rider r) {
    riders.add(r);
  }
}
