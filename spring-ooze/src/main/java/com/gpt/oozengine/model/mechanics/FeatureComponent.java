package com.gpt.oozengine.model.mechanics;

import com.gpt.oozengine.constant.rules.ComponentMode;
import com.gpt.oozengine.model.BaseEntity;
import com.gpt.oozengine.model.GlossaryEntry;
import com.gpt.oozengine.model.Spell;
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
 * One thing a feature invokes rather than does itself.
 *
 * <p>"The aboleth makes two Tentacle attacks" points at a sibling
 * {@link #referencedFeature}. "The devil casts Wall of Ice" points at a
 * {@link #referencedSpell}. "The goblin takes the Disengage action" points at
 * the {@link #referencedAction} glossary entry. Exactly one is set, enforced by
 * a check constraint.
 *
 * <p>All three were originally read as unexecutable prose, and all three are the
 * same sentence with a different object — so they are one mechanism, not three.
 * Folding them in also means {@link #mode} and {@link #choiceGroup} already
 * describe "casts Bless, Dispel Magic, Healing Word, or Lesser Restoration":
 * four CHOICE components sharing a group, which is exactly what they were built
 * for.
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
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "references_feature_id")
  private Feature referencedFeature;

  /** "The devil casts Wall of Ice (level 8 version)." */
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "references_spell_id")
  private Spell referencedSpell;

  /** The level the feature casts it at, when the book raises it above base. */
  @Column(name = "spell_level")
  private Integer spellLevel;

  /**
   * "The goblin takes the Disengage or Hide action." Points at the glossary
   * entry for the standard action, which we already import — all twelve of them
   * — so the engine can show the DM the rule it is applying.
   */
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "references_action_id")
  private GlossaryEntry referencedAction;

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
