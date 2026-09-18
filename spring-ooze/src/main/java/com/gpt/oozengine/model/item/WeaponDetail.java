package com.gpt.oozengine.model.item;

import com.gpt.oozengine.constant.rules.DamageType;
import com.gpt.oozengine.constant.rules.WeaponCategory;
import com.gpt.oozengine.constant.rules.WeaponProperty;
import com.gpt.oozengine.model.Item;
import com.gpt.oozengine.model.WeaponMastery;
import com.gpt.oozengine.model.mechanics.DiceRoll;
import jakarta.persistence.AttributeOverride;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Embeddable;
import jakarta.persistence.Embedded;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import java.util.EnumSet;
import java.util.Set;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.BatchSize;

/**
 * The weapon row of the SRD's equipment table, as mechanics rather than prose.
 *
 * <p>Embedded in {@link com.gpt.oozengine.model.Item} rather than given its own
 * table: it is strictly one-to-one with an item and only present on weapons, so
 * a join would buy nothing. The columns are nullable for every other category.
 *
 * <p>The mastery link is the one relationship the SRD prints as a table column
 * and we previously stored nowhere.
 */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
public class WeaponDetail {

  @Enumerated(EnumType.STRING)
  @Column(name = "weapon_category", length = 24)
  private WeaponCategory category;

  @Embedded
  @AttributeOverride(name = "count", column = @Column(name = "weapon_dice_count"))
  @AttributeOverride(name = "faces", column = @Column(name = "weapon_dice_faces"))
  @AttributeOverride(name = "bonus", column = @Column(name = "weapon_dice_bonus"))
  @AttributeOverride(name = "average", column = @Column(name = "weapon_dice_average"))
  private DiceRoll damage;

  @Enumerated(EnumType.STRING)
  @Column(name = "weapon_damage_type", length = 16)
  private DamageType damageType;

  /** Damage when wielded in two hands, for weapons with the Versatile property. */
  @Embedded
  @AttributeOverride(name = "count", column = @Column(name = "versatile_dice_count"))
  @AttributeOverride(name = "faces", column = @Column(name = "versatile_dice_faces"))
  @AttributeOverride(name = "bonus", column = @Column(name = "versatile_dice_bonus"))
  @AttributeOverride(name = "average", column = @Column(name = "versatile_dice_average"))
  private DiceRoll versatileDamage;

  // Batched: a page of the catalog reads this for every weapon on it, and one
  // query per row is the difference between a list and fifty of them.
  @BatchSize(size = 64)
  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(
      name = "item_weapon_properties",
      joinColumns = @JoinColumn(name = "item_id"))
  @Enumerated(EnumType.STRING)
  @Column(name = "property", nullable = false, length = 20)
  private Set<WeaponProperty> properties = EnumSet.noneOf(WeaponProperty.class);

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "mastery_id")
  private WeaponMastery mastery;

  /**
   * What this weapon fires, for the weapons with the Ammunition property. The
   * table prints the kind in the property's parentheses ("Range 80/320; Bolt")
   * and the Ammunition table stocks it as its own item, so this is the link
   * between them — which is what lets a simulator spend a Bolt on a shot.
   */
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "ammunition_id")
  private Item ammunition;

  /** Normal range in feet, for Ammunition and Thrown weapons. */
  @Column(name = "range_normal_feet")
  private Integer rangeNormalFeet;

  @Column(name = "range_long_feet")
  private Integer rangeLongFeet;

  /** Reach weapons add 5 feet; stored as the total rather than the bonus. */
  @Column(name = "weapon_reach_feet")
  private Integer reachFeet;
}
