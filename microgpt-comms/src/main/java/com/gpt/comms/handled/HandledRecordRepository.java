package com.gpt.comms.handled;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HandledRecordRepository extends JpaRepository<HandledRecord, UUID> {

  Optional<HandledRecord> findByReportId(UUID reportId);

  List<HandledRecord> findAllByOrderByHandledAtDesc();
}
