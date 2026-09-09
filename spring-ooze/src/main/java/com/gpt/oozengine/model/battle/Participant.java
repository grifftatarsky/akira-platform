package com.gpt.oozengine.model.battle;

import com.gpt.oozengine.constant.rules.Disposition;
import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One creature in one fight, and everything about it that changes.
 *
 * <p>The other half of the split the design turns on: a {@code Combatant} is
 * what a DM placed and never gets scarred by play; a Participant is what the
 * fight does to it. Damage, conditions, spent resources and initiative all live
 * here, created fresh when the battle starts, so an encounter can be run ten
 * times and come out the same each time.
 *
 * <p>The references outward are all nullable ids rather than mappings. A
 * participant can be a monster from the compendium, a character, a combatant
 * lifted off a board — or none of those, because a DM at a table types "Bandit"
 * and a hit point total and expects the tracker to work.
 */
@Entity
@Table(name = "participants")
@Getter
@Setter
@NoArgsConstructor
public class Participant extends BaseEntity {

  @Column(name = "battle_id", insertable = false, updatable = false)
  private UUID battleId;

  /** Where it was placed, when the battle came from an encounter. */
  @Column(name = "combatant_id")
  private UUID combatantId;

  @Column(name = "stat_block_id")
  private UUID statBlockId;

  @Column(name = "game_character_id")
  private UUID gameCharacterId;

  @Column(nullable = false)
  private String name;

  // region Initiative
  /** Null until rolled. */
  private Integer initiative;

  /**
   * Breaks a tie without a reroll.
   *
   * <p>Usually the Dexterity score, which is the common table convention. Stored
   * rather than derived so a tracker used without a stat block can still order
   * two participants deterministically — and so the order never changes when the
   * same battle is read twice.
   */
  @Column(name = "initiative_tiebreak", nullable = false)
  private int initiativeTiebreak;

  /** Modifier applied to the Initiative roll. */
  @Column(name = "initiative_bonus", nullable = false)
  private int initiativeBonus;

  /**
   * Caught unawares at the start.
   *
   * <p>From the glossary: "that creature is surprised, which causes it to have
   * Disadvantage on its Initiative roll". Consumed once, at Initiative — the
   * 2024 rule, and far smaller than the lost turn most people expect.
   */
  @Column(nullable = false)
  private boolean surprised;
  // endregion

  // region What the fight does to it
  @Column(name = "max_hit_points", nullable = false)
  private int maxHitPoints;

  @Column(name = "current_hit_points", nullable = false)
  private int currentHitPoints;

  @Column(name = "temporary_hit_points", nullable = false)
  private int temporaryHitPoints;

  /** Condition names, kept as text so the tracker needs no catalog to run. */
  @ElementCollection
  @CollectionTable(name = "participant_conditions",
      joinColumns = @JoinColumn(name = "participant_id"))
  @Column(name = "condition_name", nullable = false)
  private Set<String> conditions = new LinkedHashSet<>();

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private Disposition disposition = Disposition.ACTIVE;

  /** Spent by taking a Reaction, restored at the start of the creature's turn. */
  @Column(name = "reaction_available", nullable = false)
  private boolean reactionAvailable = true;

  @Column(columnDefinition = "text")
  private String notes;
  // endregion

  /** Down but not necessarily out; the tracker shows it, the DM rules on it. */
  public boolean isDown() {
    return currentHitPoints <= 0;
  }

  /** The book's threshold for "Bloodied": half its hit points or fewer. */
  public boolean isBloodied() {
    return currentHitPoints > 0 && currentHitPoints * 2 <= maxHitPoints;
  }
}
