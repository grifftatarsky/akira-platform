package com.gpt.comms.report.model;

import com.gpt.comms.model.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One abuse report, as received and verified.
 *
 * <p><b>What is deliberately not here: any of the reported material.</b> The app
 * writes a report that names a message by its hash and says nothing about what it
 * said, and the intake refuses anything that is not that report. So this table
 * holds an account of an event and the means to contact the person who reported
 * it, and never the thing complained about. That is the whole design, and the
 * reason a form exists instead of a mailbox.
 *
 * <p>Retention is not automatic. A report that leads to a filing with an
 * authority must be kept for a year under 18 U.S.C. 2258A(h); one that leads to
 * nothing is dealt with and deleted. {@link #status} is what says which, and it
 * is set by hand.
 */
@Entity
@Table(name = "abuse_report")
@Getter
@Setter
@NoArgsConstructor
public class AbuseReport extends BaseEntity {

  public enum Kind {
    TEXT,
    PHOTO
  }

  public enum Status {
    /** Received, nobody has looked yet. */
    NEW,
    /** Looked at, no filing owed. Safe to delete. */
    CLOSED,
    /** Passed to an authority. Kept a year from the filing. */
    FILED
  }

  // ---- What the app said, parsed out of the uploaded report ----

  @Column(name = "app_description", nullable = false, length = 8_000)
  private String appDescription;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private Kind kind;

  @Column(name = "sender_fingerprint", nullable = false, length = 64)
  private String senderFingerprint;

  @Column(name = "sender_short_code", nullable = false, length = 6)
  private String senderShortCode;

  @Column(name = "sender_display_name", length = 200)
  private String senderDisplayName;

  @Column(name = "message_id", nullable = false, length = 64)
  private String messageId;

  @Column(name = "sent_at", nullable = false)
  private Instant sentAt;

  @Column(name = "reported_at", nullable = false)
  private Instant reportedAt;

  @Column(name = "app_version", nullable = false, length = 60)
  private String appVersion;

  /** The verified report text, kept whole so a filing can produce it as received. */
  @Column(name = "raw_report", nullable = false, length = 64 * 1024)
  private String rawReport;

  // ---- What the person filling in the form said ----

  @Column(name = "reporter_description", nullable = false, length = 8_000)
  private String reporterDescription;

  @Column(name = "contact_name", length = 200)
  private String contactName;

  @Column(name = "contact_email", length = 320)
  private String contactEmail;

  @Column(name = "contact_phone", length = 60)
  private String contactPhone;

  @Column(name = "contact_address", length = 500)
  private String contactAddress;

  // ---- Handling ----

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private Status status = Status.NEW;

  @Column(name = "notified_at")
  private Instant notifiedAt;
}
