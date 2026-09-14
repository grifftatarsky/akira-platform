package com.gpt.oozengine.repository;

import com.gpt.oozengine.model.mechanics.Feature;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Features by owner. The simulator and the importer both want a creature's
 * actions without loading the monster aggregate, which is why {@code Feature}
 * mirrors its owner keys as read-only columns.
 */
public interface FeatureRepository extends JpaRepository<Feature, UUID> {

  List<Feature> findByStatBlockIdOrderByOrdinalAsc(UUID statBlockId);

  List<Feature> findBySpellIdOrderByOrdinalAsc(UUID spellId);

  List<Feature> findByItemIdOrderByOrdinalAsc(UUID itemId);

  List<Feature> findByVocationIdAndVocationLevelLessThanEqualOrderByVocationLevelAscOrdinalAsc(
      UUID vocationId, int level);
}
