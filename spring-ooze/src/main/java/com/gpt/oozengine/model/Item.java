package com.gpt.oozengine.model;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.ItemCategory;
import com.gpt.oozengine.constant.rules.PoisonType;
import com.gpt.oozengine.constant.rules.Rarity;
import com.gpt.oozengine.model.item.ArmorDetail;
import com.gpt.oozengine.model.item.WeaponDetail;
import com.gpt.oozengine.model.mechanics.Feature;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Weapons, armor, gear, and magic items. */
@Entity
@Table(name = "items")
@Getter
@Setter
@NoArgsConstructor
public class Item extends CatalogContent {

  @Enumerated(EnumType.STRING)
  @Column(name = "item_category", length = 24)
  private ItemCategory itemCategory;

  @Enumerated(EnumType.STRING)
  @Column(name = "rarity_tier", length = 16)
  private Rarity rarityTier;

  /**
   * The rarity phrase, where the book prints more than one — "Uncommon (+1),
   * Rare (+2), Very Rare (+3)". {@link #rarityTier} is {@code VARIES} then, and
   * this says what it varies between. Null for the single-rarity majority.
   */
  @Column(name = "rarity_note")
  private String rarityNote;

  /**
   * What a magic item is applied to, as the book prints it: "Dagger", "Any
   * Light, Medium, or Heavy", "Shield". Where the phrase names actual rows,
   * {@link #baseOptions} holds them; where it names a category it doesn't, and
   * this is the whole of what the book says.
   */
  @Column(name = "applies_to")
  private String appliesTo;

  @Column(nullable = false)
  private boolean attunement;

  /** What the attunement is restricted to, where the book restricts it. */
  @Column(name = "attunement_note")
  private String attunementNote;

  /** Cost in gold pieces; a Copper Piece is 0.01. Null for items with no price. */
  @Column(name = "cost_gp", precision = 12, scale = 2)
  private BigDecimal costGp;

  @Column(name = "weight_lb", precision = 8, scale = 2)
  private BigDecimal weightLb;

  /**
   * The book's prose, where it prints any. Null is a real answer: the Weapons
   * and Armor tables are the entry for a Longsword, and inventing a sentence
   * that restates the columns would put words in the book's mouth.
   */
  @Column(columnDefinition = "text")
  private String description;

  /** How a poison is delivered. Null for everything that isn't one. */
  @Enumerated(EnumType.STRING)
  @Column(name = "poison_type", length = 16)
  private PoisonType poisonType;

  /** The ability a tool's checks use. Null for everything that isn't a tool. */
  @Enumerated(EnumType.STRING)
  @Column(name = "tool_ability", length = 16)
  private Ability toolAbility;

  /**
   * What this tool can make. A real relation rather than the book's prose list,
   * because "what can craft a Healer's Kit" is a question a player asks and the
   * answer is a set of rows we already hold.
   */
  @ManyToMany(fetch = FetchType.LAZY)
  @JoinTable(
      name = "item_crafts",
      joinColumns = @JoinColumn(name = "tool_item_id"),
      inverseJoinColumns = @JoinColumn(name = "crafted_item_id"))
  @OrderBy("name ASC")
  private Set<Item> crafts = new LinkedHashSet<>();

  /**
   * The mundane items a magic item can be applied to, where {@link #appliesTo}
   * names them: a Dancing Sword is one of five specific swords, and a simulator
   * that has to know which weapon it is needs the row, not the sentence.
   */
  @ManyToMany(fetch = FetchType.LAZY)
  @JoinTable(
      name = "item_base_options",
      joinColumns = @JoinColumn(name = "item_id"),
      inverseJoinColumns = @JoinColumn(name = "base_item_id"))
  @OrderBy("name ASC")
  private Set<Item> baseOptions = new LinkedHashSet<>();

  /** Present only on weapons; every column is null otherwise. */
  @Embedded private WeaponDetail weapon;

  /** Present only on armor and shields. */
  @Embedded private ArmorDetail armor;

  /**
   * What the item lets its holder do. A Longsword's attack, a Potion of Healing's
   * 2d4 + 2, a Bag of Holding's capacity rules — all the same shape as a
   * monster's actions, which is what lets one combat engine handle both.
   */
  @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  // nullable = false is load-bearing: without it Hibernate inserts the child
  // with a null foreign key and updates it afterwards, which trips
  // ck_features_single_owner because the row momentarily has no owner.
  @JoinColumn(name = "item_id", nullable = false)
  @OrderBy("ordinal ASC")
  private List<Feature> features = new ArrayList<>();

  public void addFeature(Feature f) {
    f.setOrdinal(features.size());
    features.add(f);
  }
}
