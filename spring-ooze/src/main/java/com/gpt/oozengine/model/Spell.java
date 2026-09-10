package com.gpt.oozengine.model;

import com.gpt.oozengine.constant.MagicSchool;
import com.gpt.oozengine.constant.rules.Activation;
import com.gpt.oozengine.constant.rules.RangeType;
import com.gpt.oozengine.constant.rules.TimeUnit;
import com.gpt.oozengine.model.mechanics.Feature;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.hibernate.annotations.BatchSize;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A spell.
 *
 * <p>Carries both the book's own phrasing and the structure the engine needs.
 * That duplication is deliberate: "Self (60-foot Cone)" is a range and an area
 * in one printed string, and a DM comparing the page against the book should
 * find the book's words, not a reconstruction of them.
 */
@Entity
@Table(name = "spells")
@Getter
@Setter
@NoArgsConstructor
public class Spell extends CatalogContent {

  // region Basic Info
  /// 0 = cantrip, 1-9 = spell levels.
  @Column(nullable = false)
  private int level;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private MagicSchool school;

  /**
   * Which classes have this spell on their list. The SRD prints it after every
   * spell's school; 879 such links exist across the book.
   */
  // Batched: the spell list is 339 rows, and resolving each one's classes with
  // its own query is the difference between one page load and 340.
  @BatchSize(size = 64)
  @ManyToMany(fetch = FetchType.LAZY)
  @JoinTable(
      name = "spell_vocations",
      joinColumns = @JoinColumn(name = "spell_id"),
      inverseJoinColumns = @JoinColumn(name = "vocation_id"))
  private Set<Vocation> vocations = new LinkedHashSet<>();
  // endregion

  // region Casting — printed form, then structured
  @Column(name = "casting_time")
  private String castingTime;

  @Enumerated(EnumType.STRING)
  @Column(name = "cast_activation", length = 24)
  private Activation castActivation;

  @Column(name = "cast_time_amount")
  private Integer castTimeAmount;

  @Enumerated(EnumType.STRING)
  @Column(name = "cast_time_unit", length = 16)
  private TimeUnit castTimeUnit;

  private String range;

  @Enumerated(EnumType.STRING)
  @Column(name = "range_type", length = 16)
  private RangeType rangeType;

  @Column(name = "range_feet")
  private Integer rangeFeet;

  private String duration;

  @Column(name = "duration_amount")
  private Integer durationAmount;

  @Enumerated(EnumType.STRING)
  @Column(name = "duration_unit", length = 16)
  private TimeUnit durationUnit;

  @Column(nullable = false)
  private boolean concentration;

  @Column(nullable = false)
  private boolean ritual;
  // endregion

  // region Components
  @Column(name = "verbal_component", nullable = false)
  private boolean verbalComponent;

  @Column(name = "somatic_component", nullable = false)
  private boolean somaticComponent;

  @Column(name = "material_component", nullable = false)
  private boolean materialComponent;

  @Column(name = "materials", columnDefinition = "text")
  private String materials;

  /** Gold value of a costly material component; null when it has none. */
  @Column(name = "material_cost_gp")
  private Integer materialCostGp;

  @Column(name = "material_consumed", nullable = false)
  private boolean materialConsumed;
  // endregion

  // region Descriptions
  @Column(nullable = false, columnDefinition = "text")
  private String description;

  @Column(name = "at_higher_levels", columnDefinition = "text")
  private String atHigherLevels;
  // endregion

  /**
   * What the spell actually does. Most spells are one feature; those with modes
   * (Elementalism's four, Arcane Hand's clenched fist and grasping hand) are
   * several, which is also how a battle plan gets to pick between them.
   */
  @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  // nullable = false is load-bearing: without it Hibernate inserts the child
  // with a null foreign key and updates it afterwards, which trips
  // ck_features_single_owner because the row momentarily has no owner.
  @JoinColumn(name = "spell_id", nullable = false)
  @OrderBy("ordinal ASC")
  private List<Feature> features = new ArrayList<>();

  public void addFeature(Feature f) {
    f.setOrdinal(features.size());
    features.add(f);
  }
}
