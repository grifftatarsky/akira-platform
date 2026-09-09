package com.gpt.oozengine.repository;

import com.gpt.oozengine.model.battle.Battle;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** Battles belong to one DM; there is no shared or public battle. */
public interface BattleRepository extends JpaRepository<Battle, UUID> {

  Page<Battle> findByOwnerId(UUID ownerId, Pageable pageable);
}
