package com.gpt.oozengine.model;

import com.gpt.oozengine.constant.rules.FeatCategory;
import com.gpt.oozengine.model.mechanics.Feature;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Feats — Origin, General, Fighting Style, and Epic Boon. */
@Entity
@Table(name = "feats")
@Getter
@Setter
@NoArgsConstructor
public class Feat extends CatalogContent {

  @Enumerated(EnumType.STRING)
  @Column(name = "category", nullable = false, length = 24)
  private FeatCategory category;

  /** Prerequisite text, e.g. "Level 4+, Strength or Dexterity 13+"; null if none. */
  private String prerequisite;

  /** True for the feats the book marks Repeatable. */
  @Column(nullable = false)
  private boolean repeatable;

  @Column(nullable = false, columnDefinition = "text")
  private String description;

  /** The feat's individual benefits, where they are mechanically distinct. */
  @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  // nullable = false is load-bearing: without it Hibernate inserts the child
  // with a null foreign key and updates it afterwards, which trips
  // ck_features_single_owner because the row momentarily has no owner.
  @JoinColumn(name = "feat_id", nullable = false)
  @OrderBy("ordinal ASC")
  private List<Feature> features = new ArrayList<>();

  public void addFeature(Feature f) {
    f.setOrdinal(features.size());
    features.add(f);
  }
}
