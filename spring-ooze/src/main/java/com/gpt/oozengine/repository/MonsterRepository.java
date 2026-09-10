package com.gpt.oozengine.repository;

import com.gpt.oozengine.model.Monster;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;

/**
 * Bestiary entries.
 *
 * <p>Every read overrides the inherited finder to fetch the stat block with the
 * monster. Without it, listing the bestiary is a query per monster — tolerable
 * at the four rows we have, ruinous at the 253 the SRD import will add. The
 * collections below the block are handled by {@code @BatchSize} rather than by
 * extending the graph: two levels of list in one fetch build a cartesian
 * product, and Hibernate declines to generate it.
 */
public interface MonsterRepository extends CatalogRepository<Monster> {

  @Override
  @EntityGraph(attributePaths = "statBlock")
  List<Monster> findByOwnerIdIsNull();

  @Override
  @EntityGraph(attributePaths = "statBlock")
  List<Monster> findByOwnerId(UUID ownerId);

  @Override
  @EntityGraph(attributePaths = "statBlock")
  Optional<Monster> findById(UUID id);
}
