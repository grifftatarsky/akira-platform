package com.gpt.oozengine.model.encounter;

import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A saved setup: a map, its terrain, and everything placed on it.
 *
 * <p>Reusable and edited freely. Running it creates a Battle, which holds
 * everything that changes during a fight, so an Encounter can be played ten
 * times without accumulating scars. "Run this encounter three times" is three
 * Battles against one Encounter.
 */
@Entity
@Table(name = "encounters")
@Getter
@Setter
@NoArgsConstructor
public class Encounter extends BaseEntity {

  /** The DM who owns it. Encounters are working data, not shared catalog content. */
  @Column(name = "owner_id", nullable = false)
  private UUID ownerId;

  @Column(nullable = false)
  private String name;

  @Column(columnDefinition = "text")
  private String description;

  @OneToOne(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "battle_map_id", nullable = false)
  private BattleMap map;

  @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  @JoinColumn(name = "encounter_id", nullable = false)
  private List<Combatant> combatants = new ArrayList<>();

  public void addCombatant(Combatant c) {
    combatants.add(c);
  }
}
