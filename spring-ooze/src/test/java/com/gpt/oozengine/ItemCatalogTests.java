package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.ArmorCategory;
import com.gpt.oozengine.constant.rules.DamageType;
import com.gpt.oozengine.constant.rules.ItemCategory;
import com.gpt.oozengine.constant.rules.Rarity;
import com.gpt.oozengine.constant.rules.WeaponCategory;
import com.gpt.oozengine.constant.rules.WeaponProperty;
import com.gpt.oozengine.model.Item;
import com.gpt.oozengine.model.dto.request.ArmorDetailRequest;
import com.gpt.oozengine.model.dto.request.ItemRequest;
import com.gpt.oozengine.model.dto.request.WeaponDetailRequest;
import com.gpt.oozengine.model.dto.response.ItemRef;
import com.gpt.oozengine.model.dto.response.ItemResponse;
import com.gpt.oozengine.repository.ItemRepository;
import com.gpt.oozengine.service.ItemService;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * The SRD 5.2.1 equipment and magic item import.
 *
 * <p>Asserted as counts and as specific rows, because a parser that silently
 * drops a table section still produces plausible-looking output — every defect
 * found while writing the bestiary importer was found by a number that didn't
 * match, never by reading the result.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class ItemCatalogTests {

  @Autowired private MockMvc mvc;
  @Autowired private ItemRepository items;
  @Autowired private ItemService service;
  @Autowired private EntityManager em;

  private Item byName(String name) {
    return items.findByOwnerIdIsNull().stream()
        .filter(i -> i.getName().equals(name))
        .findFirst()
        .orElseThrow(() -> new AssertionError("no item named " + name));
  }

  @Test
  @Transactional
  @DisplayName("every section of the equipment and magic item chapters is present")
  void catalogIsComplete() {
    Map<ItemCategory, Long> byCategory =
        items.findByOwnerIdIsNull().stream()
            .collect(Collectors.groupingBy(Item::getItemCategory, Collectors.counting()));

    // 440 from Equipment and Magic Items A-Z, plus the Gameplay Toolbox's 14
    // sample poisons, which the book prices per dose and so are items.
    assertThat(items.findByOwnerIdIsNull()).hasSize(440 + 14);
    // The book's own tables: 38 weapons, 12 armors and a Shield, 5 kinds of
    // ammunition, 17 artisan's tools plus 8 others, 24 mounts and vehicles.
    assertThat(byCategory)
        .containsEntry(ItemCategory.AMMUNITION, 5L)
        .containsEntry(ItemCategory.TOOL, 25L)
        .containsEntry(ItemCategory.MOUNT_OR_VEHICLE, 24L)
        .containsEntry(ItemCategory.POISON, 14L);
    // Three categories are fed by both chapters — the equipment table and
    // Magic Items A-Z, which files a Dwarven Plate under Armor like any other.
    assertThat(byCategory.get(ItemCategory.WEAPON)).isEqualTo(38 + 32);
    assertThat(byCategory.get(ItemCategory.ARMOR)).isEqualTo(12 + 12);
    assertThat(byCategory.get(ItemCategory.SHIELD)).isEqualTo(1 + 7);
    // 253 magic items, over the ten categories the type line uses.
    long magic =
        items.findByOwnerIdIsNull().stream().filter(i -> i.getRarityTier() != null).count();
    assertThat(magic).isEqualTo(253);
  }

  @Test
  @Transactional
  @DisplayName("a weapon carries the whole of its row")
  void weaponRow() {
    Item longsword = byName("Longsword");
    var w = longsword.getWeapon();

    assertThat(w.getCategory()).isEqualTo(WeaponCategory.MARTIAL_MELEE);
    assertThat(w.getDamage().expression()).isEqualTo("1d8");
    assertThat(w.getDamageType()).isEqualTo(DamageType.SLASHING);
    assertThat(w.getVersatileDamage().expression()).isEqualTo("1d10");
    assertThat(w.getProperties()).containsExactly(WeaponProperty.VERSATILE);
    assertThat(w.getMastery().getName()).isEqualTo("Sap");
    assertThat(longsword.getCostGp()).isEqualByComparingTo("15");
    assertThat(longsword.getWeightLb()).isEqualByComparingTo("3");
    // The Weapons table is the entry; the book prints no prose for a Longsword.
    assertThat(longsword.getDescription()).isNull();
  }

  @Test
  @Transactional
  @DisplayName("a ranged weapon links the ammunition it spends")
  void weaponAmmunition() {
    assertThat(byName("Longbow").getWeapon().getAmmunition().getName()).isEqualTo("Arrows");
    // The table prints "Bullet" for both; the weapon decides which one it is.
    assertThat(byName("Sling").getWeapon().getAmmunition().getName()).isEqualTo("Bullets, Sling");
    assertThat(byName("Musket").getWeapon().getAmmunition().getName())
        .isEqualTo("Bullets, Firearm");
    // An embedded block is never null once it owns a collection, so "not a
    // weapon" reads as a null category rather than a null block.
    assertThat(byName("Club").getWeapon().getAmmunition()).isNull();
    assertThat(byName("Backpack").getWeapon().getCategory()).isNull();
  }

  @Test
  @Transactional
  @DisplayName("armor is stored as the AC formula, not as a total")
  void armorRow() {
    var halfPlate = byName("Half Plate Armor").getArmor();
    assertThat(halfPlate.getCategory()).isEqualTo(ArmorCategory.MEDIUM);
    assertThat(halfPlate.getBaseArmorClass()).isEqualTo(15);
    assertThat(halfPlate.getAddsDexterity()).isTrue();
    assertThat(halfPlate.getDexterityCap()).isEqualTo(2);
    assertThat(halfPlate.getStealthDisadvantage()).isTrue();
    assertThat(halfPlate.getStrengthRequirement()).isNull();

    var plate = byName("Plate Armor").getArmor();
    assertThat(plate.getBaseArmorClass()).isEqualTo(18);
    assertThat(plate.getAddsDexterity()).isFalse();
    assertThat(plate.getStrengthRequirement()).isEqualTo(15);

    var shield = byName("Shield").getArmor();
    assertThat(shield.getArmorClassBonus()).isEqualTo(2);
    assertThat(shield.getBaseArmorClass()).isNull();
    // Don and doff times belong to the category, which is where the book prints
    // them, so a Shield answers with the Utilize action's zero minutes.
    assertThat(ArmorCategory.HEAVY.donMinutes()).isEqualTo(10);
    assertThat(shield.getCategory().donMinutes()).isZero();
  }

  @Test
  @Transactional
  @DisplayName("a tool's Craft list is a relation, not a sentence")
  void toolCrafts() {
    Item herbalism = byName("Herbalism Kit");
    assertThat(herbalism.getToolAbility()).isEqualTo(Ability.INTELLIGENCE);
    assertThat(herbalism.getCrafts())
        .extracting(Item::getName)
        .contains("Antitoxin", "Candle", "Healer's Kit", "Potion of Healing");
    // The gear table indexes by keyword and the Craft lists read naturally, so
    // this one only resolves if the alias rule held.
    assertThat(byName("Alchemist's Supplies").getCrafts())
        .extracting(Item::getName)
        .contains("Component Pouch", "Acid");
  }

  @Test
  @Transactional
  @DisplayName("a magic item names the mundane items it can be applied to")
  void magicItemBaseOptions() {
    Item dancing = byName("Dancing Sword");
    assertThat(dancing.getRarityTier()).isEqualTo(Rarity.VERY_RARE);
    assertThat(dancing.isAttunement()).isTrue();
    assertThat(dancing.getAppliesTo())
        .isEqualTo("Greatsword, Longsword, Rapier, Scimitar, or Shortsword");
    assertThat(dancing.getBaseOptions())
        .extracting(Item::getName)
        .containsExactlyInAnyOrder("Greatsword", "Longsword", "Rapier", "Scimitar", "Shortsword");

    // A category qualifier names no rows, and correctly links none.
    Item plus = byName("Weapon, +1, +2, or +3");
    assertThat(plus.getRarityTier()).isEqualTo(Rarity.VARIES);
    assertThat(plus.getRarityNote()).isEqualTo("Uncommon (+1), Rare (+2), Very Rare (+3)");
    assertThat(plus.getAppliesTo()).isEqualTo("Any Simple or Martial");
    assertThat(plus.getBaseOptions()).isEmpty();

    assertThat(byName("Wand of the War Mage, +1, +2, or +3").getAttunementNote())
        .isEqualTo("by a Spellcaster");
  }

  @Test
  @Transactional
  @DisplayName("the bestiary's Gear lines resolve now that the items exist")
  void bestiaryGearResolves() {
    long staged =
        ((Number) em.createNativeQuery("select count(*) from bestiary_gear_staging")
                .getSingleResult())
            .longValue();
    long linked =
        ((Number) em.createNativeQuery("select count(*) from stat_block_gear").getSingleResult())
            .longValue();

    // 100 Gear lines over 45 stat blocks, of which 029 could link four. The two
    // that still don't are a plain "Wand", which is not an item in the book —
    // Magic Items A-Z has thirteen specific wands and no generic one.
    assertThat(staged).isEqualTo(100);
    assertThat(linked).isEqualTo(98);
  }

  @Test
  @DisplayName("editing an item keeps its mechanics")
  void overrideRoundTrips() {
    UUID user = UUID.randomUUID();
    ItemResponse before = service.get(idOf("Longsword"), null);

    ItemResponse after =
        service.update(
            before.id(),
            new ItemRequest(
                before.name(),
                before.itemCategory(),
                before.rarityTier(),
                before.rarityNote(),
                before.appliesTo(),
                before.costGp(),
                new BigDecimal("4"),
                before.attunement(),
                before.attunementNote(),
                "My table's longsword is a little heavier.",
                before.toolAbility(),
                before.poisonType(),
                new WeaponDetailRequest(
                    WeaponCategory.valueOf(before.weapon().category()),
                    before.weapon().diceCount(),
                    before.weapon().diceFaces(),
                    before.weapon().diceBonus(),
                    DamageType.valueOf(before.weapon().damageType()),
                    before.weapon().versatileDiceCount(),
                    before.weapon().versatileDiceFaces(),
                    before.weapon().properties().stream().map(WeaponProperty::valueOf)
                        .collect(Collectors.toSet()),
                    before.weapon().masteryId(),
                    null,
                    null,
                    null,
                    null),
                null,
                List.of(),
                List.of()),
            user);
    try {
      // The whole point: a DM correcting the weight must not silently strip the
      // weapon of the damage that makes it a weapon.
      assertThat(after.weightLb()).isEqualByComparingTo("4");
      assertThat(after.weapon().damage()).isEqualTo("1d8");
      assertThat(after.weapon().versatileDamage()).isEqualTo("1d10");
      assertThat(after.weapon().masteryName()).isEqualTo("Sap");
      assertThat(after.weapon().properties()).containsExactly("VERSATILE");
      assertThat(after.base()).isFalse();
      assertThat(after.srdVersion()).isEqualTo(before.srdVersion());
    } finally {
      service.revert(before.id(), user);
    }
  }

  private UUID idOf(String name) {
    return items.findByOwnerIdIsNull().stream()
        .filter(i -> i.getName().equals(name))
        .map(Item::getId)
        .findFirst()
        .orElseThrow();
  }

  @Test
  @DisplayName("the editor's payload deserialises and comes back whole")
  void restRoundTripsTheEditorPayload() throws Exception {
    UUID base = idOf("Chain Mail");
    UUID user = UUID.randomUUID();
    // Byte for byte what ItemEditor.value() merges into the panel's body. The
    // service test proves the mapping; this proves the wire format agrees with
    // it, which is the half a refactor of either side can quietly break.
    String body =
        """
        {
          "name": "Chain Mail",
          "itemCategory": "ARMOR",
          "costGp": 75,
          "weightLb": 55,
          "attunement": false,
          "description": null,
          "weapon": null,
          "armor": {
            "category": "HEAVY",
            "baseArmorClass": 16,
            "addsDexterity": false,
            "dexterityCap": null,
            "strengthRequirement": 13,
            "stealthDisadvantage": true,
            "armorClassBonus": null
          },
          "craftIds": [],
          "baseOptionIds": []
        }
        """;

    mvc.perform(
            put("/item/{id}", base)
                .with(
                    jwt()
                        .jwt(j -> j.subject(user.toString()))
                        .authorities(new SimpleGrantedAuthority("MANAGE_CONTENT")))
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.armor.category").value("HEAVY"))
        .andExpect(jsonPath("$.armor.baseArmorClass").value(16))
        .andExpect(jsonPath("$.armor.strengthRequirement").value(13))
        .andExpect(jsonPath("$.armor.stealthDisadvantage").value(true))
        // Don and doff come from the category, so they arrive without being sent.
        .andExpect(jsonPath("$.armor.donMinutes").value(10))
        .andExpect(jsonPath("$.armor.doffMinutes").value(5))
        .andExpect(jsonPath("$.base").value(false))
        .andExpect(jsonPath("$.srdVersion").value("SRD_5_2"));

    // The override outlives the transaction, and the count assertions in this
    // class read base rows only — but leaving one behind still muddies a rerun.
    service.revert(base, user);
  }

  @Test
  @Transactional
  @DisplayName("list rows leave the prose behind")
  void listRowsAreSummaries() {
    List<ItemRef> nothing = List.of();
    ItemResponse summary = ItemResponse.summary(byName("Bag of Holding"));
    assertThat(summary.description()).isNull();
    assertThat(summary.crafts()).isEqualTo(nothing);
    assertThat(ItemResponse.from(byName("Bag of Holding")).description())
        .contains("interior space considerably larger");
  }
}
