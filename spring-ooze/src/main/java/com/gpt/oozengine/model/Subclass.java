package com.gpt.oozengine.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A class's subclass — SRD 5.2 publishes exactly one per class.
 *
 * <p>Its features are ordinary {@link com.gpt.oozengine.model.mechanics.Feature}
 * rows carrying both a vocation and this subclass, so a character's feature list
 * is one query over the vocation with an optional subclass filter, rather than
 * two lists that have to be merged in the right order.
 */
@Entity
@Table(name = "subclasses")
@Getter
@Setter
@NoArgsConstructor
public class Subclass extends CatalogContent {

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "vocation_id", nullable = false)
  private Vocation vocation;

  @Column(columnDefinition = "text")
  private String description;
}
