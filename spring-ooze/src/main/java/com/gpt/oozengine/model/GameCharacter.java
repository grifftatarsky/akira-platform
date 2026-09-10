package com.gpt.oozengine.model;

import com.gpt.oozengine.constant.CharacterKind;
import com.gpt.oozengine.model.creature.StatBlock;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A player character or NPC.
 *
 * <p>Shares its mechanics with the bestiary through {@link StatBlock}, which is
 * what lets an encounter put a rogue and an ogre on the same initiative order
 * without the simulator caring which is which.
 *
 * <p>Species, class and background became foreign keys rather than free text.
 * That is what turns a character sheet from a record of what someone typed into
 * something derivable: proficiency bonus from the class's level table, features
 * from the class and species, AC from worn armor.
 */
@Entity
@Table(name = "characters")
@Getter
@Setter
@NoArgsConstructor
public class GameCharacter extends BaseEntity {

  @Column(name = "owner_id", nullable = false)
  private UUID ownerId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 32)
  private CharacterKind kind;

  @Column(nullable = false)
  private String name;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "species_id")
  private Species species;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "vocation_id")
  private Vocation vocation;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "subclass_id")
  private Subclass subclass;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "background_id")
  private Background background;

  private Integer level;

  @OneToOne(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  @JoinColumn(name = "stat_block_id")
  private StatBlock statBlock;

  @Column(columnDefinition = "text")
  private String description;

  @Column(columnDefinition = "text")
  private String notes;

  /**
   * The creature this NPC was built from, when it was built from one.
   *
   * <p>An NPC wraps a monster the way a character wraps a species: "Grish,
   * goblin boss, three levels of Fighter, carrying a magic sword" is a
   * GameCharacter whose own {@link #statBlock} started as a copy of the Goblin
   * Boss's, and which then grew an inventory, levels and hit points of its own.
   *
   * <p>Provenance only — a bare id, not a mapping, so the base can be renamed or
   * re-imported without dragging this along. It answers "what was this?", which
   * is a question a DM asks and the engine never does.
   */
  @Column(name = "base_stat_block_id")
  private java.util.UUID baseStatBlockId;
}
