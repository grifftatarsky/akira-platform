package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.ArmorCategory;

/**
 * The armor row of the equipment table, as an editable payload.
 *
 * <p>AC is sent as the formula's parts rather than a total, so a wearer's AC
 * stays right when their Dexterity changes: base plus modifier, capped, or a
 * flat bonus for a Shield.
 */
public record ArmorDetailRequest(
    ArmorCategory category,
    Integer baseArmorClass,
    Boolean addsDexterity,
    Integer dexterityCap,
    Integer strengthRequirement,
    Boolean stealthDisadvantage,
    Integer armorClassBonus) {}
