package com.gpt.comms.report;

import com.gpt.comms.report.model.AbuseReport;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AbuseReportRepository extends JpaRepository<AbuseReport, UUID> {

  List<AbuseReport> findAllByOrderByCreatedAtAsc();

  /**
   * Oldest first, deliberately.
   *
   * <p>A queue read newest-first starves the bottom of it, and the bottom of this queue is somebody
   * who has been waiting longest to hear anything.
   */
  List<AbuseReport> findAllByStatusOrderByCreatedAtAsc(AbuseReport.Status status);
}
