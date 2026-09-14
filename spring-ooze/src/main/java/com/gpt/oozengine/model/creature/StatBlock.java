package com.gpt.oozengine.model.creature;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.Alignment;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.CreatureType;
import com.gpt.oozengine.constant.rules.UniqueBehavior;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.model.BaseEntity;
import com.gpt.oozengine.model.Condition;
import com.gpt.oozengine.model.mechanics.DiceRoll;
import com.gpt.oozengine.model.mechanics.Feature;
import jakarta.persistence.AttributeOverride;
import jakarta.persistence.CascadeType;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.MapKeyEnumerated;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import org.hibernate.annotations.BatchSize;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Everything mechanical about one creature: the stat block, structured.
 *
 * <p>Deliberately separate from {@link com.gpt.oozengine.model.Monster} and
 * {@link com.gpt.oozengine.model.GameCharacter}, which are catalog concerns —
 * ownership, overrides, the finder's name and flavour text. A stat block is what
 * fights. Keeping it as its own table means an encounter can point at one thing
 * whether the combatant is a bestiary entry or a player's rogue, and every
 * collection below hangs off one foreign key instead of two.
 *
 * <p>Fields follow the printed stat block top to bottom, so that transcribing
 * one by hand — which is how homebrew arrives, and how a careful import ought to
 * be checked — is a matter of reading down the page.
 */
@Entity
@Table(name = "stat_blocks")
@Getter
@Setter
@NoArgsConstructor
public class StatBlock extends BaseEntity {

  // region Header line
  @Enumerated(EnumType.STRING)
  @Column(length = 16)
  private CreatureSize size;

  @Enumerated(EnumType.STRING)
  @Column(name = "creature_type", length = 24)
  private CreatureType creatureType;

  /** e.g. "Devil" on a Fiend, printed in parentheses after the type. */
  @Column(name = "creature_subtype")
  private String creatureSubtype;

  @Enumerated(EnumType.STRING)
  @Column(length = 24)
  private Alignment alignment;
  // endregion

  // region Defences
  @Column(name = "armor_class")
  private Integer armorClass;

  /** For the handful of blocks whose AC is conditional or a formula. */
  @Column(name = "armor_class_note")
  private String armorClassNote;

  /** The "+7" in "Initiative +7 (17)"; the parenthesised value is 10 + this. */
  @Column(name = "initiative_bonus")
  private Integer initiativeBonus;

  /**
   * Average and dice both, i.e. "150 (20d10 + 40)". The simulator rolls the dice
   * for a fresh creature and uses the average when a DM wants fixed hit points.
   */
  @Embedded
  @AttributeOverride(name = "count", column = @Column(name = "hp_dice_count"))
  @AttributeOverride(name = "faces", column = @Column(name = "hp_dice_faces"))
  @AttributeOverride(name = "bonus", column = @Column(name = "hp_dice_bonus"))
  @AttributeOverride(name = "average", column = @Column(name = "hp_average"))
  private DiceRoll hitPoints;
  // endregion

  // region Movement
  /** One speed per mode the creature has; absent means it cannot move that way. */
  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(
      name = "stat_block_speeds",
      joinColumns = @JoinColumn(name = "stat_block_id"))
  @MapKeyEnumerated(EnumType.STRING)
  @MapKeyColumn(name = "movement_type", length = 16)
  @Column(name = "speed_feet", nullable = false)
  private Map<MovementType, Integer> speeds = new EnumMap<>(MovementType.class);

  /** "Fly 90 ft. (hover)" — hovering creatures don't fall when Incapacitated. */
  @Column(name = "can_hover", nullable = false)
  private boolean canHover;
  // endregion

  // region Abilities and saves
  @Column(name = "score_strength")
  private Integer strength;

  @Column(name = "score_dexterity")
  private Integer dexterity;

  @Column(name = "score_constitution")
  private Integer constitution;

  @Column(name = "score_intelligence")
  private Integer intelligence;

  @Column(name = "score_wisdom")
  private Integer wisdom;

  @Column(name = "score_charisma")
  private Integer charisma;

  /**
   * Total saving-throw bonus per ability, where the book prints one that differs
   * from the bare modifier. Absent means "modifier only", which is what the
   * simulator falls back to.
   */
  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(
      name = "stat_block_saves",
      joinColumns = @JoinColumn(name = "stat_block_id"))
  @MapKeyEnumerated(EnumType.STRING)
  @MapKeyColumn(name = "ability", length = 16)
  @Column(name = "bonus", nullable = false)
  private Map<Ability, Integer> saveBonuses = new EnumMap<>(Ability.class);

  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(
      name = "stat_block_skills",
      joinColumns = @JoinColumn(name = "stat_block_id"))
  @OrderBy("skill ASC")
  private Set<SkillBonus> skills = new LinkedHashSet<>();
  // endregion

  // region Perception and resistances
  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(
      name = "stat_block_senses",
      joinColumns = @JoinColumn(name = "stat_block_id"))
  private Set<SenseRange> senses = new LinkedHashSet<>();

  @Column(name = "passive_perception")
  private Integer passivePerception;

  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(
      name = "stat_block_damage_responses",
      joinColumns = @JoinColumn(name = "stat_block_id"))
  private Set<DamageResponse> damageResponses = new LinkedHashSet<>();

  /**
   * A join to the catalog rather than an enum set: a DM's homebrew condition
   * should be immunisable, and the finder wants to link the row.
   */
  @ManyToMany(fetch = FetchType.LAZY)
  @JoinTable(
      name = "stat_block_condition_immunities",
      joinColumns = @JoinColumn(name = "stat_block_id"),
      inverseJoinColumns = @JoinColumn(name = "condition_id"))
  private Set<Condition> conditionImmunities = new LinkedHashSet<>();
  // endregion

  // region Communication
  @Column(columnDefinition = "text")
  private String languages;

  @Column(name = "telepathy_feet")
  private Integer telepathyFeet;
  // endregion

  // region Challenge
  /** Numeric so it sorts and compares; 1/8, 1/4 and 1/2 are 0.125, 0.25, 0.5. */
  @Column(name = "challenge_rating", precision = 5, scale = 3)
  private BigDecimal challengeRating;

  @Column(name = "experience_points")
  private Integer experiencePoints;

  @Column(name = "proficiency_bonus")
  private Integer proficiencyBonus;
  // endregion

  // region Spellcasting
  @Enumerated(EnumType.STRING)
  @Column(name = "spellcasting_ability", length = 16)
  private Ability spellcastingAbility;

  @Column(name = "spell_save_dc")
  private Integer spellSaveDc;

  @Column(name = "spell_attack_bonus")
  private Integer spellAttackBonus;

  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(
      name = "stat_block_spells",
      joinColumns = @JoinColumn(name = "stat_block_id"))
  @OrderBy("spellLevel ASC")
  private Set<KnownSpell> knownSpells = new LinkedHashSet<>();
  // endregion

  // region Equipment and abilities
  /** The stat block's "Gear" line. Drives AC and weapon attacks for the simulator. */
  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(
      name = "stat_block_gear",
      joinColumns = @JoinColumn(name = "stat_block_id"))
  private Set<GearEntry> gear = new LinkedHashSet<>();

  /** Traits, actions, bonus actions, reactions and legendary actions alike. */
  @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  // nullable = false is load-bearing: without it Hibernate inserts the child
  // with a null foreign key and updates it afterwards, which trips
  // ck_features_single_owner because the row momentarily has no owner.
  @JoinColumn(name = "stat_block_id", nullable = false)
  @OrderBy("ordinal ASC")
  // Batched so that listing the bestiary costs a query per page of stat
  // blocks rather than one per creature.
  @BatchSize(size = 64)
  private List<Feature> features = new ArrayList<>();

  /** Total legendary actions per round, where the creature has any. */
  @Column(name = "legendary_action_uses")
  private Integer legendaryActionUses;

  /**
   * The one creature-specific rule this stat block needs that no general
   * mechanism covers, or null — which is all but two of the 330.
   *
   * <p>A hydra's heads set its Multiattack count, grant it extra Reactions and
   * kill it when they run out; a shrieker shrieks because something walked past,
   * with nobody choosing to. Neither is a rider, an effect or a component, and
   * generalising for a population of one would cost more than a named branch.
   * {@code UniqueBehaviorService} switches on this and owns the shape of
   * {@link #uniqueData}.
   */
  @Enumerated(EnumType.STRING)
  @Column(name = "unique_behavior", length = 48)
  private UniqueBehavior uniqueBehavior;

  /**
   * Starting state for {@link #uniqueBehavior}, as JSON.
   *
   * <p>Deliberately schemaless. The alternative is a column per behaviour, every
   * one of them null on 329 rows out of 330, and a migration each time a new
   * creature needs one. A battle copies this to the participant and mutates its
   * copy, so the stat block keeps the book's opening position.
   */
  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "unique_data", columnDefinition = "jsonb")
  private Map<String, Object> uniqueData;
  // endregion

  public void addFeature(Feature f) {
    f.setOrdinal(features.size());
    features.add(f);
  }

  /** The modifier for an ability score, or null if the score is unset. */
  public Integer modifier(Ability ability) {
    Integer score =
        switch (ability) {
          case STRENGTH -> strength;
          case DEXTERITY -> dexterity;
          case CONSTITUTION -> constitution;
          case INTELLIGENCE -> intelligence;
          case WISDOM -> wisdom;
          case CHARISMA -> charisma;
        };
    return score == null ? null : Math.floorDiv(score - 10, 2);
  }

  /** Saving-throw bonus: the printed one where there is one, else the modifier. */
  public Integer saveBonus(Ability ability) {
    Integer printed = saveBonuses.get(ability);
    return printed != null ? printed : modifier(ability);
  }
}
