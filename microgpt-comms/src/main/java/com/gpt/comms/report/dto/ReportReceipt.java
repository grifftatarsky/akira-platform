package com.gpt.comms.report.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * What the form is told after a report is accepted.
 *
 * <p>The reference is the row's id. It is given back so a reporter writing in
 * later has something to name, and it is the only thing this endpoint ever
 * returns about a report.
 */
public record ReportReceipt(UUID reference, Instant receivedAt) {}
