package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.ItemCategory;
import com.gpt.oozengine.constant.rules.PoisonType;
import com.gpt.oozengine.constant.rules.Rarity;
import com.gpt.oozengine.model.Item;
import com.gpt.oozengine.model.item.ArmorDetail;
import com.gpt.oozengine.model.item.WeaponDetail;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public record ItemResponse(
    UUID id,
    String name,
    ItemCategory itemCategory,
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
    WeaponView weapon,
    ArmorView armor,
    List<ItemRef> crafts,
    List<ItemRef> baseOptions,
    List<FeatureResponse> features,
    boolean base,
    UUID overridesId,
    SrdVersion srdVersion) {

  /** The weapon row, with the mastery and ammunition resolved to links. */
  public record WeaponView(
      String category,
      Integer diceCount,
      Integer diceFaces,
      Integer diceBonus,
      String damage,
      String damageType,
      Integer versatileDiceCount,
      Integer versatileDiceFaces,
      String versatileDamage,
      List<String> properties,
      UUID masteryId,
      String masteryName,
      ItemRef ammunition,
      Integer rangeNormalFeet,
      Integer rangeLongFeet,
      Integer reachFeet) {

    static WeaponView of(WeaponDetail w) {
      if (w == null || w.getCategory() == null) {
        return null;
      }
      var d = w.getDamage();
      var v = w.getVersatileDamage();
      return new WeaponView(
          w.getCategory().name(),
          d == null ? null : d.getCount(),
          d == null ? null : d.getFaces(),
          d == null ? null : d.getBonus(),
          d == null ? null : d.expression(),
          w.getDamageType() == null ? null : w.getDamageType().name(),
          v == null ? null : v.getCount(),
          v == null ? null : v.getFaces(),
          v == null ? null : v.expression(),
          w.getProperties().stream().map(Enum::name).sorted().toList(),
          w.getMastery() == null ? null : w.getMastery().getId(),
          w.getMastery() == null ? null : w.getMastery().getName(),
          ItemRef.of(w.getAmmunition()),
          w.getRangeNormalFeet(),
          w.getRangeLongFeet(),
          w.getReachFeet());
    }
  }

  /**
   * The armor row. Don and doff times come from the category rather than the
   * row, which is where the book prints them.
   */
  public record ArmorView(
      String category,
      Integer baseArmorClass,
      Boolean addsDexterity,
      Integer dexterityCap,
      Integer strengthRequirement,
      Boolean stealthDisadvantage,
      Integer armorClassBonus,
      int donMinutes,
      int doffMinutes) {

    static ArmorView of(ArmorDetail a) {
      if (a == null || a.getCategory() == null) {
        return null;
      }
      return new ArmorView(
          a.getCategory().name(),
          a.getBaseArmorClass(),
          a.getAddsDexterity(),
          a.getDexterityCap(),
          a.getStrengthRequirement(),
          a.getStealthDisadvantage(),
          a.getArmorClassBonus(),
          a.getCategory().donMinutes(),
          a.getCategory().doffMinutes());
    }
  }

  public static ItemResponse from(Item i) {
    return build(i, i.getDescription(), i.getFeatures().stream().map(FeatureResponse::from).toList(),
        refs(i.getCrafts()), refs(i.getBaseOptions()));
  }

  /**
   * A list row: the same item without the parts that only matter once it is
   * open. The catalog is 440 items and their prose alone is 200 KB, which is
   * not worth sending to draw a list of names.
   */
  public static ItemResponse summary(Item i) {
    return build(i, null, List.of(), List.of(), List.of());
  }

  private static List<ItemRef> refs(Set<Item> items) {
    return items.stream().map(ItemRef::of).toList();
  }

  private static ItemResponse build(
      Item i,
      String description,
      List<FeatureResponse> features,
      List<ItemRef> crafts,
      List<ItemRef> baseOptions) {
    return new ItemResponse(
        i.getId(),
        i.getName(),
        i.getItemCategory(),
        i.getRarityTier(),
        i.getRarityNote(),
        i.getAppliesTo(),
        i.getCostGp(),
        i.getWeightLb(),
        i.isAttunement(),
        i.getAttunementNote(),
        description,
        i.getToolAbility(),
        i.getPoisonType(),
        WeaponView.of(i.getWeapon()),
        ArmorView.of(i.getArmor()),
        crafts,
        baseOptions,
        features,
        i.isBaseContent(),
        i.getOverridesId(),
        i.getSrdVersion());
  }
}
