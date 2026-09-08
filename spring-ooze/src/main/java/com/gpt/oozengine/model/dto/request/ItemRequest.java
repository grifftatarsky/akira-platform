package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.ItemCategory;
import com.gpt.oozengine.constant.rules.PoisonType;
import com.gpt.oozengine.constant.rules.Rarity;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Everything an item is, so that editing one doesn't quietly destroy it: a
 * request that carried only the name and the prose would strip a Longsword of
 * its damage the first time a DM corrected a typo in it.
 *
 * @param craftIds what this tool can make
 * @param baseOptionIds the mundane items this magic item can be applied to
 */
public record ItemRequest(
    @NotBlank String name,
    @NotNull ItemCategory itemCategory,
    Rarity rarityTier,
    String rarityNote,
    String appliesTo,
    BigDecimal costGp,
    BigDecimal weightLb,
    boolean attunement,
    String attunementNote,
    String description,
    Ability toolAbility,
    PoisonType poisonType,
    @Valid WeaponDetailRequest weapon,
    @Valid ArmorDetailRequest armor,
    List<UUID> craftIds,
    List<UUID> baseOptionIds) {}
