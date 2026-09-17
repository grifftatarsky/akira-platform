package com.gpt.comms.report;

import com.gpt.comms.report.model.AbuseReport;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AbuseReportRepository extends JpaRepository<AbuseReport, UUID> {}
