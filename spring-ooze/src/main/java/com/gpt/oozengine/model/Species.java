package com.gpt.oozengine.model;

import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.CreatureType;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.model.mechanics.Feature;
import jakarta.persistence.CascadeType;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.MapKeyEnumerated;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** A playable ancestry, and the traits it grants. */
@Entity
@Table(name = "species")
@Getter
@Setter
@NoArgsConstructor
public class Species extends CatalogContent {

  @Enumerated(EnumType.STRING)
  @Column(length = 16)
  private CreatureSize size;

  /** Some species let the player choose Small or Medium. */
  @Enumerated(EnumType.STRING)
  @Column(name = "alternate_size", length = 16)
  private CreatureSize alternateSize;

  @Enumerated(EnumType.STRING)
  @Column(name = "creature_type", length = 24)
  private CreatureType creatureType;

  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(name = "species_speeds", joinColumns = @JoinColumn(name = "species_id"))
  @MapKeyEnumerated(EnumType.STRING)
  @MapKeyColumn(name = "movement_type", length = 16)
  @Column(name = "speed_feet", nullable = false)
  private Map<MovementType, Integer> speeds = new EnumMap<>(MovementType.class);

  @Column(columnDefinition = "text")
  private String description;

  /**
   * Darkvision, Fire Resistance, Breath Weapon and the rest, as executable
   * features rather than one prose blob — a Dragonborn's breath is an attack the
   * simulator has to be able to make.
   */
  @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  // nullable = false is load-bearing: without it Hibernate inserts the child
  // with a null foreign key and updates it afterwards, which trips
  // ck_features_single_owner because the row momentarily has no owner.
  @JoinColumn(name = "species_id", nullable = false)
  @OrderBy("ordinal ASC")
  private List<Feature> features = new ArrayList<>();

  public void addFeature(Feature f) {
    f.setOrdinal(features.size());
    features.add(f);
  }
}
