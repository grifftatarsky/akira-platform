package com.gpt.oozengine.model;

import com.gpt.oozengine.constant.rules.GlossaryCategory;
import jakarta.persistence.Column;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Rules-glossary entries — a term and its definition.
 *
 * <p>The fifteen conditions the glossary also defines live in {@code conditions}
 * instead: effects point at those by id, so they need rows of their own, and one
 * rule carried in two tables is one rule that can drift.
 */
@Entity
@Table(name = "glossary_entries")
@Getter
@Setter
@NoArgsConstructor
public class GlossaryEntry extends CatalogContent {

  /**
   * The book's own bracketed tag — [Action], [Hazard], [Area of Effect],
   * [Attitude] — or null for the 114 plain entries. It is a classification the
   * SRD makes itself, not one we invented, and it is what lets the finder group
   * the twelve actions together.
   */
  @Enumerated(EnumType.STRING)
  @Column(length = 24)
  private GlossaryCategory category;

  @Column(nullable = false, columnDefinition = "text")
  private String description;
}
