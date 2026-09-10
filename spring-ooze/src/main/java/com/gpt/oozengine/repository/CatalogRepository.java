package com.gpt.oozengine.repository;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.model.CatalogContent;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.repository.NoRepositoryBean;

/**
 * Shared queries for any catalog content table. Each content type's repository
 * extends this with its concrete entity, inheriting the ownership lookups the
 * override logic needs (see {@code AbstractCatalogService}).
 *
 * <p>{@link JpaSpecificationExecutor} is what the paged finder runs on: the
 * visibility rules and the finder's filters compose as {@link CatalogSpecs}
 * predicates rather than multiplying into one query per combination.
 */
@NoRepositoryBean
public interface CatalogRepository<E extends CatalogContent>
    extends JpaRepository<E, UUID>, JpaSpecificationExecutor<E> {

  /** Base, shared, unowned content. */
  List<E> findByOwnerIdIsNull();

  /** A user's own rows: their overrides and creations. */
  List<E> findByOwnerId(UUID ownerId);

  /** A user's override of a specific base row, if any. */
  Optional<E> findByOwnerIdAndOverridesId(UUID ownerId, UUID overridesId);

  /**
   * Which SRD editions this catalog actually draws on.
   *
   * <p>Drives whether the finder offers its edition toggle at all — a folder
   * with nothing but 5.2 in it shouldn't ask. Deliberately not scoped to the
   * caller: filtering it by what they can currently see would make the toggle
   * disappear the moment they switched it off, with no way back.
   */
  @Query("select distinct e.srdVersion from #{#entityName} e where e.srdVersion is not null")
  List<SrdVersion> findDistinctSrdVersions();
}
