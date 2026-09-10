package com.gpt.oozengine.model.mechanics;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.AttackKind;
import com.gpt.oozengine.constant.rules.Delivery;
import com.gpt.oozengine.constant.rules.StepTrigger;
import com.gpt.oozengine.constant.rules.ValueSource;
import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.BatchSize;

/**
 * One roll in a feature's resolution, and what it does.
 *
 * <p>Most features are a single step. A minority chain: the book writes "Melee
 * Attack Roll: +5 … Hit: 12 (2d8 + 3) Piercing damage. If the target is a
 * Humanoid, it is subjected to the following effect. Constitution Saving Throw:
 * DC 12. Failure: The target is cursed", which is an attack and then, on a hit,
 * a save. Fourteen creatures in the bestiary work that way, and flattening them
 * into one delivery would silently drop the second roll — the difference between
 * a werewolf that can infect you and one that just bites.
 *
 * <p>{@link #trigger} is what makes the chain conditional, and
 * {@link #targetFilter} carries the book's gate on who is subject to it at all.
 */
@Entity
@Table(name = "feature_steps")
@Getter
@Setter
@NoArgsConstructor
public class FeatureStep extends BaseEntity {

  @Column(nullable = false)
  private int ordinal;

  /** Read-only mirror of the owning column; lets the engine query steps directly. */
  @Column(name = "feature_id", insertable = false, updatable = false)
  private UUID featureId;

  @Enumerated(EnumType.STRING)
  @Column(name = "step_trigger", nullable = false, length = 24)
  private StepTrigger trigger = StepTrigger.ALWAYS;

  /** e.g. "If the target is a Humanoid" — who this step applies to at all. */
  @Column(name = "target_filter", columnDefinition = "text")
  private String targetFilter;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private Delivery delivery = Delivery.AUTOMATIC;

  @Enumerated(EnumType.STRING)
  @Column(name = "attack_kind", length = 20)
  private AttackKind attackKind;

  @Column(name = "attack_bonus")
  private Integer attackBonus;

  @Enumerated(EnumType.STRING)
  @Column(name = "attack_bonus_source", length = 24)
  private ValueSource attackBonusSource;

  @Column(name = "reach_feet")
  private Integer reachFeet;

  @Column(name = "range_feet")
  private Integer rangeFeet;

  @Column(name = "range_long_feet")
  private Integer rangeLongFeet;

  @Enumerated(EnumType.STRING)
  @Column(name = "save_ability", length = 16)
  private Ability saveAbility;

  @Column(name = "save_dc")
  private Integer saveDc;

  @Enumerated(EnumType.STRING)
  @Column(name = "save_dc_source", length = 24)
  private ValueSource saveDcSource;

  @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  @BatchSize(size = 64)
  @JoinColumn(name = "step_id", nullable = false)
  @OrderBy("ordinal ASC")
  private List<Effect> effects = new ArrayList<>();

  public void addEffect(Effect e) {
    e.setOrdinal(effects.size());
    effects.add(e);
  }
}
