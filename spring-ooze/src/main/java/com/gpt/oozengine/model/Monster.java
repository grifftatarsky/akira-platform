package com.gpt.oozengine.model;

import com.gpt.oozengine.model.creature.StatBlock;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A bestiary entry: the catalog wrapper around a {@link StatBlock}.
 *
 * <p>Monster owns the things the compendium cares about — a name, flavour text,
 * who may edit it, which SRD it came from — and delegates everything mechanical.
 * The split exists so that an encounter can reference one kind of fighting thing
 * whether it came from the bestiary or from a player's character sheet.
 *
 * <p>The stat block is owned outright: cascading the delete means a DM's homebrew
 * ogre takes its actions with it, and copy-on-writing a base monster copies the
 * mechanics too rather than sharing them with the original.
 */
@Entity
@Table(name = "monsters")
@Getter
@Setter
@NoArgsConstructor
public class Monster extends CatalogContent {

  /** Flavour text. Everything mechanical lives on the stat block. */
  @Column(columnDefinition = "text")
  private String description;

  @OneToOne(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  @JoinColumn(name = "stat_block_id")
  private StatBlock statBlock;
}
