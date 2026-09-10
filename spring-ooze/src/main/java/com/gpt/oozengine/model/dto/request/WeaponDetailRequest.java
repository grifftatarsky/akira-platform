package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.DamageType;
import com.gpt.oozengine.constant.rules.WeaponCategory;
import com.gpt.oozengine.constant.rules.WeaponProperty;
import java.util.Set;
import java.util.UUID;

/**
 * The weapon row of the equipment table, as an editable payload.
 *
 * <p>Present only on weapons; a null here clears the block. The Blowgun deals a
 * flat 1, which is why the damage is a count/faces/bonus triple rather than a
 * required die — the bonus alone is a legal weapon.
 */
public record WeaponDetailRequest(
    WeaponCategory category,
    Integer diceCount,
    Integer diceFaces,
    Integer diceBonus,
    DamageType damageType,
    Integer versatileDiceCount,
    Integer versatileDiceFaces,
    Set<WeaponProperty> properties,
    UUID masteryId,
    UUID ammunitionId,
    Integer rangeNormalFeet,
    Integer rangeLongFeet,
    Integer reachFeet) {}
