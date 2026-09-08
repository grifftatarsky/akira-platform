package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.constant.rules.ItemCategory;
import com.gpt.oozengine.model.Item;
import com.gpt.oozengine.model.dto.request.ArmorDetailRequest;
import com.gpt.oozengine.model.dto.request.ItemRequest;
import com.gpt.oozengine.model.dto.request.WeaponDetailRequest;
import com.gpt.oozengine.model.dto.response.ItemResponse;
import com.gpt.oozengine.model.item.ArmorDetail;
import com.gpt.oozengine.model.item.WeaponDetail;
import com.gpt.oozengine.model.mechanics.DiceRoll;
import com.gpt.oozengine.repository.CatalogRepository;
import com.gpt.oozengine.repository.HiddenContentRepository;
import com.gpt.oozengine.repository.ItemRepository;
import com.gpt.oozengine.repository.WeaponMasteryRepository;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ItemService extends AbstractCatalogService<Item, ItemRequest, ItemResponse> {

  private final ItemRepository items;
  private final HiddenContentRepository hidden;
  private final WeaponMasteryRepository masteries;

  @Override
  protected CatalogRepository<Item> repo() {
    return items;
  }

  @Override
  protected HiddenContentRepository hiddenRepo() {
    return hidden;
  }

  @Override
  protected ContentType contentType() {
    return ContentType.ITEM;
  }

  @Override
  protected Item instantiate() {
    return new Item();
  }

  @Override
  protected void apply(ItemRequest r, Item i) {
    i.setName(r.name());
    i.setItemCategory(r.itemCategory());
    i.setRarityTier(r.rarityTier());
    i.setRarityNote(r.rarityNote());
    i.setAppliesTo(r.appliesTo());
    i.setCostGp(r.costGp());
    i.setWeightLb(r.weightLb());
    i.setAttunement(r.attunement());
    i.setAttunementNote(r.attunementNote());
    i.setDescription(r.description());
    i.setToolAbility(r.toolAbility());
    i.setPoisonType(r.poisonType());
    applyWeapon(r.weapon(), i);
    applyArmor(r.armor(), i);
    replace(i.getCrafts(), r.craftIds());
    replace(i.getBaseOptions(), r.baseOptionIds());
  }

  private void applyWeapon(WeaponDetailRequest r, Item i) {
    if (r == null || r.category() == null) {
      i.setWeapon(null);
      return;
    }
    WeaponDetail w = i.getWeapon() == null ? new WeaponDetail() : i.getWeapon();
    w.setCategory(r.category());
    w.setDamage(dice(r.diceCount(), r.diceFaces(), r.diceBonus()));
    w.setDamageType(r.damageType());
    w.setVersatileDamage(dice(r.versatileDiceCount(), r.versatileDiceFaces(), null));
    w.getProperties().clear();
    if (r.properties() != null) {
      w.getProperties().addAll(r.properties());
    }
    w.setMastery(r.masteryId() == null ? null : masteries.findById(r.masteryId()).orElse(null));
    w.setAmmunition(r.ammunitionId() == null ? null : items.findById(r.ammunitionId()).orElse(null));
    w.setRangeNormalFeet(r.rangeNormalFeet());
    w.setRangeLongFeet(r.rangeLongFeet());
    w.setReachFeet(r.reachFeet());
    i.setWeapon(w);
  }

  private void applyArmor(ArmorDetailRequest r, Item i) {
    if (r == null || r.category() == null) {
      i.setArmor(null);
      return;
    }
    ArmorDetail a = i.getArmor() == null ? new ArmorDetail() : i.getArmor();
    a.setCategory(r.category());
    a.setBaseArmorClass(r.baseArmorClass());
    a.setAddsDexterity(r.addsDexterity());
    a.setDexterityCap(r.dexterityCap());
    a.setStrengthRequirement(r.strengthRequirement());
    a.setStealthDisadvantage(r.stealthDisadvantage());
    a.setArmorClassBonus(r.armorClassBonus());
    i.setArmor(a);
  }

  private static DiceRoll dice(Integer count, Integer faces, Integer bonus) {
    if (count == null && faces == null && bonus == null) {
      return null;
    }
    DiceRoll d = new DiceRoll();
    d.setCount(count);
    d.setFaces(faces);
    d.setBonus(bonus);
    return d;
  }

  /** Swap a link set's contents without replacing the collection Hibernate owns. */
  private void replace(Set<Item> links, List<UUID> ids) {
    links.clear();
    if (ids != null) {
      ids.stream().map(items::findById).flatMap(Optional::stream).forEach(links::add);
    }
  }

  /**
   * Base items of one category, as summaries.
   *
   * <p>Separate from the paged list because it answers a different question:
   * the list is what a reader browses, this is what an editor picks from — the
   * five kinds of ammunition a weapon can fire, say, which no amount of paging
   * over 440 rows by name gets you.
   */
  @Transactional(readOnly = true)
  public List<ItemResponse> byCategory(ItemCategory category) {
    return items.findByOwnerIdIsNullAndItemCategory(category, Sort.by("name")).stream()
        .map(ItemResponse::summary)
        .toList();
  }

  @Override
  protected ItemResponse toResponse(Item i) {
    return ItemResponse.from(i);
  }

  /**
   * List rows leave out the prose and the links. 440 items with their
   * descriptions is a third of a megabyte; the finder fetches the one that's
   * opened.
   */
  @Override
  protected ItemResponse toListResponse(Item i) {
    return ItemResponse.summary(i);
  }
}
