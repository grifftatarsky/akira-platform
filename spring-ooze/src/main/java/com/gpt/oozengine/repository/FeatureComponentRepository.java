package com.gpt.oozengine.repository;

import com.gpt.oozengine.model.mechanics.FeatureComponent;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FeatureComponentRepository extends JpaRepository<FeatureComponent, UUID> {

  /**
   * Delete every Multiattack line belonging to one stat block, in one statement.
   *
   * <p>Written as a bulk delete rather than left to the cascade because a
   * component's reference to a sibling feature is NOT NULL: when the stat block
   * is removed whole, Hibernate finds a component whose target is already
   * scheduled for deletion and nulls the reference — an UPDATE the constraint
   * rejects, so deleting any creature with a Multiattack fails. Clearing the
   * collection first doesn't help, because that produces the same UPDATE.
   * Removing the rows outright, before the entities are touched, does.
   */
  @Modifying
  @Query(
      value =
          """
          delete from feature_components
          where feature_id in (select id from features where stat_block_id = :statBlockId)
          """,
      nativeQuery = true)
  void deleteForStatBlock(@Param("statBlockId") UUID statBlockId);
}
