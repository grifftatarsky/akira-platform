package com.gpt.oozengine.model.mechanics;

import com.gpt.oozengine.constant.rules.ComponentMode;
import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
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
 * One line of a Multiattack: "makes two Tentacle attacks" is a component
 * pointing at the Tentacle feature with a count of 2.
 *
 * <p>Modelled as a reference rather than by duplicating the attack, so that
 * editing Tentacle's damage changes what Multiattack does — which is what a DM
 * means when they buff a monster's attack.
 *
 * <p>{@link #optional} carries the SRD's "if available" and "can use": a line
 * the creature may skip. {@link #mode} carries how the line combines with the
 * others — the difference between three attacks split across two weapons and
 * three attacks with each — and {@link #choiceGroup} says which components are
 * alternatives to one another.
 */
@Entity
@Table(name = "feature_components")
@Getter
@Setter
@NoArgsConstructor
public class FeatureComponent extends BaseEntity {

  /**
   * Cascade PERSIST is load-bearing: on the first save of a new stat block the
   * sibling this points at is still transient, and without it Hibernate reaches
   * this row first and writes the reference as null rather than persisting the
   * feature it depends on. The sibling is also reachable from the stat block, so
   * the cascade finds an already-managed instance and inserts nothing twice.
   */
  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "references_feature_id", nullable = false)
  private Feature referencedFeature;

  @Column(nullable = false)
  private int count = 1;

  @Column(nullable = false)
  private boolean optional;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private ComponentMode mode = ComponentMode.FIXED;

  /**
   * Components sharing a group are alternatives: pick among them rather than
   * doing all of them. Null for a component that stands on its own.
   *
   * <p>A plain integer, unique only within the one Multiattack that owns these
   * rows — there is nothing to point a foreign key at, and numbering per parent
   * keeps the emitted data readable as a diff.
   */
  @Column(name = "choice_group")
  private Integer choiceGroup;

  @Column(nullable = false)
  private int ordinal;
}
