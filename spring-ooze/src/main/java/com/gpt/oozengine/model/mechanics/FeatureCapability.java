package com.gpt.oozengine.model.mechanics;

import com.gpt.oozengine.constant.rules.Capability;
import com.gpt.oozengine.constant.rules.DamageType;
import com.gpt.oozengine.constant.rules.TimeUnit;
import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One standing capability a feature grants its owner.
 *
 * <p>A row per capability rather than a set on the feature, because most of them
 * carry a number the engine needs: Hold Breath is an hour, Detect at Range is a
 * distance, Standing Leap is two distances. A bare enum would represent that a
 * frog jumps further without saying how much further, which is not the same as
 * being true to the book.
 */
@Entity
@Table(name = "feature_capabilities")
@Getter
@Setter
@NoArgsConstructor
public class FeatureCapability extends BaseEntity {

  @Column(name = "feature_id", insertable = false, updatable = false)
  private UUID featureId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 48)
  private Capability capability;

  /** The distance, duration or count the capability carries, if any. */
  private Integer amount;

  /** What {@link #amount} counts — feet for a range, minutes for held breath. */
  @Enumerated(EnumType.STRING)
  @Column(length = 16)
  private TimeUnit durationUnit;

  /** Set when the capability is scoped to one damage type. */
  @Enumerated(EnumType.STRING)
  @Column(name = "damage_type", length = 16)
  private DamageType damageType;

  /**
   * A second distance, for the two capabilities that need one — Standing Leap's
   * Long Jump and High Jump, and any "Bright Light N feet, Dim Light N more".
   */
  @Column(name = "second_amount")
  private Integer secondAmount;

  /** The book's own wording, always kept so a DM can check our reading. */
  @Column(columnDefinition = "text")
  private String notes;
}
