package com.gpt.oozengine.model;

import com.gpt.oozengine.constant.SrdVersion;
import jakarta.persistence.Column;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.MappedSuperclass;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * Shared ownership for catalog content (spells, species, vocations, …).
 *
 * <p>{@code ownerId == null} marks base 5e content: loaded via Liquibase, shared
 * by everyone, and immutable. {@code ownerId} set marks a single user's private
 * content. A user never edits a base row in place — editing one copy-on-writes a
 * new owned row whose {@link #overridesId} points at the base row it shadows
 * (see the services). {@code overridesId == null} on an owned row means brand-new
 * user content rather than an override.
 *
 * <p>{@code overridesId} is a plain id column, not a JPA association: the target
 * is always the same table as the row itself, so a self-referencing FK is added
 * per table in Liquibase rather than modelled polymorphically here.
 */
@MappedSuperclass
@Getter
@Setter
public abstract class CatalogContent extends BaseEntity {

  /**
   * Every catalog type has one, and it is what the finder sorts and searches
   * on. Declared here so a single query can page and filter any of them.
   */
  @Column(nullable = false)
  private String name;

  @Column(name = "owner_id")
  private UUID ownerId;

  @Column(name = "overrides_id")
  private UUID overridesId;

  /**
   * Which SRD this row's rules came from, or null for content that isn't from
   * an SRD at all — a DM's own creation. An override inherits the version of
   * the base row it shadows, so hiding an edition hides a DM's edited copies of
   * it too rather than stranding them in the list.
   */
  @Enumerated(EnumType.STRING)
  @Column(name = "srd_version", length = 16)
  private SrdVersion srdVersion;

  /** True for shared, unowned, immutable base content. */
  public boolean isBaseContent() {
    return ownerId == null;
  }
}
