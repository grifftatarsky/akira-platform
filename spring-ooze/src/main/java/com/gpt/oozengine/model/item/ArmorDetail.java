package com.gpt.oozengine.model.item;

import com.gpt.oozengine.constant.rules.ArmorCategory;
import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * The armor row of the equipment table.
 *
 * <p>AC is a formula, not a number: Light armor adds the full Dexterity
 * modifier, Medium caps it at +2, Heavy ignores it. Storing {@link #baseArmorClass}
 * and {@link #dexterityCap} separately lets the simulator compute a wearer's AC
 * instead of a DM copying a total that goes stale when Dexterity changes.
 * A null cap on Light armor means uncapped; on Heavy, {@link #addsDexterity} is
 * false and the cap is irrelevant.
 */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
public class ArmorDetail {

  @Enumerated(EnumType.STRING)
  @Column(name = "armor_category", length = 16)
  private ArmorCategory category;

  /** The 14 in "14 + Dex modifier (max 2)", or the flat 18 of Plate. */
  @Column(name = "base_armor_class")
  private Integer baseArmorClass;

  @Column(name = "adds_dexterity")
  private Boolean addsDexterity;

  @Column(name = "dexterity_cap")
  private Integer dexterityCap;

  /** Minimum Strength score, below which the wearer's speed drops by 10 feet. */
  @Column(name = "strength_requirement")
  private Integer strengthRequirement;

  @Column(name = "stealth_disadvantage")
  private Boolean stealthDisadvantage;

  /** A Shield's contribution is a bonus to AC rather than a base. */
  @Column(name = "armor_class_bonus")
  private Integer armorClassBonus;
}
