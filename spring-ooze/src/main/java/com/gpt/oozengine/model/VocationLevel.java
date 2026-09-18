package com.gpt.oozengine.model;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One row of a class's level table.
 *
 * <p>{@link #spellSlots} is keyed by spell level, so a level-5 Wizard's
 * {@code {1: 4, 2: 3, 3: 2}} is directly the resource pool the simulator spends.
 *
 * <p>{@link #classValues} is the deliberate escape hatch. Every class table has
 * columns nobody else has — Rages, Sneak Attack, Focus Points, Martial Arts die
 * — and inventing a column per class would mean a migration every time a class
 * is added, including homebrew ones. A labelled list keeps the level table
 * faithful without pretending those columns are shared, and keeps them in the
 * order the book prints them.
 */
@Entity
@Table(name = "vocation_levels")
@Getter
@Setter
@NoArgsConstructor
public class VocationLevel extends BaseEntity {

  @Column(nullable = false)
  private int level;

  @Column(name = "proficiency_bonus", nullable = false)
  private int proficiencyBonus;

  /**
   * The Class Features cell as the book prints it — "Action Surge (two uses)",
   * "Subclass feature", "—". The features themselves are rows of their own, but
   * this cell says things they don't: which use of an escalating feature this
   * level grants, and where a subclass slots in.
   */
  @Column(name = "feature_summary")
  private String featureSummary;

  @Column(name = "cantrips_known")
  private Integer cantripsKnown;

  @Column(name = "prepared_spells")
  private Integer preparedSpells;

  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(
      name = "vocation_level_spell_slots",
      joinColumns = @JoinColumn(name = "vocation_level_id"))
  @MapKeyColumn(name = "slot_level")
  @Column(name = "slots", nullable = false)
  private Map<Integer, Integer> spellSlots = new TreeMap<>();

  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(
      name = "vocation_level_values",
      joinColumns = @JoinColumn(name = "vocation_level_id"))
  @OrderColumn(name = "ordinal")
  private List<ClassValue> classValues = new ArrayList<>();
}
