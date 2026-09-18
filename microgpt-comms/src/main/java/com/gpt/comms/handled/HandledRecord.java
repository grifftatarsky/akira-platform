package com.gpt.comms.handled;

import com.gpt.comms.model.BaseEntity;
import com.gpt.comms.report.model.AbuseReport;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * What is left after a report is deleted: the fact of it, with none of its contents.
 *
 * <p>The site tells a reporter their copy is deleted, and it has to be true. So this row carries no
 * description, no fingerprint, no message id and no way to reach anybody — only that a report of
 * some kind arrived, when it was handled, whether it was referred and to whom, and when the copy
 * went. It is what makes "we no longer hold it" and "we can say how many of these there were" both
 * true at once.
 *
 * <p>Its id is the report's id, deliberately: a reporter who kept their reference can be told what
 * happened to it without anything about it having been kept.
 */
@Entity
@Table(name = "handled_record")
@Getter
@Setter
@NoArgsConstructor
public class HandledRecord extends BaseEntity {

  public enum Outcome {
    /** Passed to an authority. {@link #referredTo} names which. */
    REFERRED,
    /** Read, answered, nothing to pass on. */
    NO_ACTION
  }

  /** The report's own id, so a reference a reporter kept still resolves. */
  @Column(name = "report_id", nullable = false, unique = true)
  private UUID reportId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 32)
  private AbuseReport.Category category;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private Outcome outcome;

  @Column(name = "referred_to", length = 200)
  private String referredTo;

  @Column(name = "received_at", nullable = false)
  private Instant receivedAt;

  @Column(name = "handled_at", nullable = false)
  private Instant handledAt;

  /** Null while a copy is still held — under law, or because the reply did not send. */
  @Column(name = "deleted_at")
  private Instant deletedAt;

  /** Whether the reporter was told. False where they left no address or asked not to hear. */
  @Column(name = "reporter_told", nullable = false)
  private boolean reporterTold;
}
