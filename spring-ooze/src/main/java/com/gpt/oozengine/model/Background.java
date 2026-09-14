package com.gpt.oozengine.model;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.Skill;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.util.EnumSet;
import java.util.Set;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Character backgrounds — the three abilities they raise, the feat they grant,
 * and the proficiencies and kit they start with. */
@Entity
@Table(name = "backgrounds")
@Getter
@Setter
@NoArgsConstructor
public class Background extends CatalogContent {

  /** The three abilities a background offers; the player splits +2/+1 or +1/+1/+1. */
  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(name = "background_abilities", joinColumns = @JoinColumn(name = "background_id"))
  @Enumerated(EnumType.STRING)
  @Column(name = "ability", nullable = false, length = 16)
  private Set<Ability> abilityScores = EnumSet.noneOf(Ability.class);

  /**
   * The Origin feat this background grants. A real foreign key: it was a string
   * until changeset 025 deleted twelve backgrounds and came within one join of
   * leaving twelve dangling feat names behind.
   */
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "feat_id")
  private Feat feat;

  /** Some backgrounds name a specific spell list for Magic Initiate. */
  @Column(name = "feat_note")
  private String featNote;

  @ElementCollection(fetch = FetchType.LAZY)
  @CollectionTable(name = "background_skills", joinColumns = @JoinColumn(name = "background_id"))
  @Enumerated(EnumType.STRING)
  @Column(name = "skill", nullable = false, length = 24)
  private Set<Skill> skillProficiencies = EnumSet.noneOf(Skill.class);

  /**
   * Left as text: the SRD's tool entries are a mix of a named tool and a choice
   * from a category ("one kind of Gaming Set"), and no rule keys off which.
   */
  @Column(name = "tool_proficiencies")
  private String toolProficiencies;

  @Column(columnDefinition = "text")
  private String equipment;

  @Column(nullable = false, columnDefinition = "text")
  private String description;
}
