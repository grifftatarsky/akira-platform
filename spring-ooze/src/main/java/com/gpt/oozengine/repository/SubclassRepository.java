package com.gpt.oozengine.repository;

import com.gpt.oozengine.model.Subclass;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Subclasses, looked up by their parent class. */
public interface SubclassRepository extends JpaRepository<Subclass, UUID> {

  List<Subclass> findByVocationIdOrderByNameAsc(UUID vocationId);
}
