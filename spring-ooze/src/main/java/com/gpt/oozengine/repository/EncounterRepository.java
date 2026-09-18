package com.gpt.oozengine.repository;

import com.gpt.oozengine.model.encounter.Encounter;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Encounters are working data owned by one DM, not shared catalog content, so
 * there is no override or hidden-content machinery here — just an owner.
 */
public interface EncounterRepository extends JpaRepository<Encounter, UUID> {

  Page<Encounter> findByOwnerId(UUID ownerId, Pageable pageable);

  /**
   * The map and its cells in one round trip.
   *
   * <p>Only one collection is fetched here. Adding {@code combatants} to the
   * same query makes two bag fetches, which Hibernate refuses outright — so the
   * combatant list is batched instead (see {@code Encounter.combatants}), which
   * costs one extra query rather than a cartesian product.
   */
  @Query("select e from Encounter e left join fetch e.map m left join fetch m.cells"
      + " where e.id = :id")
  Optional<Encounter> findWithBoardById(@Param("id") UUID id);

  Optional<Encounter> findByIdAndOwnerId(UUID id, UUID ownerId);
}
