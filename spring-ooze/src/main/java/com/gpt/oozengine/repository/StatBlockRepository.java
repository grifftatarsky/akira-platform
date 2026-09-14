package com.gpt.oozengine.repository;

import com.gpt.oozengine.model.creature.StatBlock;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Stat blocks. Owned by a monster or a character; the encounter engine reads
 * them directly, which is the reason they are their own aggregate. */
public interface StatBlockRepository extends JpaRepository<StatBlock, UUID> {}
