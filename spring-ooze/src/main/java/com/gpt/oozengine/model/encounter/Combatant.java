package com.gpt.oozengine.model.encounter;

import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.Disposition;
import com.gpt.oozengine.model.BaseEntity;
import com.gpt.oozengine.model.GameCharacter;
import com.gpt.oozengine.model.creature.StatBlock;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One thing placed on the board, before the fight starts.
 *
 * <p><b>The SRD row is never copied to play.</b> A Combatant points at a base —
 * a {@link StatBlock} for a monster, or a {@link GameCharacter} for a PC or NPC,
 * which itself may wrap a monster stat block the way a character wraps a species
 * — and carries a thin sheet of its own for the things a DM changes when
 * placing: the name on the token, more hit points, a different size. Everything
 * that changes <em>during</em> a fight lives on the Battle's participant
 * instead, so this row is never scarred by playing it.
 *
 * <p>Cloning a stat block is reserved for genuine surgery ("this goblin has a
 * different attack"), and even then it is an override row pointing back at the
 * original, not a copy of the catalog.
 */
@Entity
@Table(name = "combatants")
@Getter
@Setter
@NoArgsConstructor
public class Combatant extends BaseEntity {

  @Column(name = "encounter_id", insertable = false, updatable = false)
  private UUID encounterId;

  /** Set for a monster placed straight from the compendium. */
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "stat_block_id")
  private StatBlock statBlock;

  /** Set for a PC or a named NPC, which carries its own inventory and slots. */
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "game_character_id")
  private GameCharacter gameCharacter;

  /** "Goblin #3", "Grish". Falls back to the base's name when blank. */
  private String name;

  // region Placement — continuous, in half-feet, per Geometry
  @Column(name = "x_half_feet", nullable = false)
  private int x;

  @Column(name = "y_half_feet", nullable = false)
  private int y;

  /** Elevation. Flying and standing on the balcony are the same field. */
  @Column(name = "z_half_feet", nullable = false)
  private int z;
  // endregion

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private Disposition disposition = Disposition.ACTIVE;

  /**
   * Caught unawares when the fight starts. Per the glossary: "that creature is
   * surprised, which causes it to have Disadvantage on its Initiative roll" —
   * the 2024 rule, and far smaller than the lost turn most people expect. Read
   * once, at Initiative, and never again.
   */
  @Column(nullable = false)
  private boolean surprised;

  // region The sheet — what a DM changes while placing, not while playing
  /** Overrides the base's rolled or average hit points. */
  @Column(name = "max_hit_points")
  private Integer maxHitPoints;

  /** Overrides the base's size, which changes the footprint and so reach and cover. */
  @Enumerated(EnumType.STRING)
  @Column(length = 16)
  private CreatureSize size;

  @Column(columnDefinition = "text")
  private String notes;
  // endregion
}
