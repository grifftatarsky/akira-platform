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

  /**
   * What the reporter said this is, and the only thing that decides where it goes.
   *
   * <p>The slugs are the values the form posts and they are published on
   * /resources beside the route each one takes, so the routing is knowable before
   * a report is sent rather than after. {@link #heldByLaw()} marks the one
   * category where deleting on handling is not ours to choose.
   */
  public enum Category {
    CHILD_SEXUAL("child-sexual", true),
    THREAT("threat", false),
    SELF_HARM("self-harm", false),
    HARASSMENT("harassment", false),
    INTIMATE_IMAGES("intimate-images", false),
    FRAUD("fraud", false),
    HATE("hate", false),
    OTHER("other", false);

    private final String slug;
    private final boolean heldByLaw;

    Category(String slug, boolean heldByLaw) {
      this.slug = slug;
      this.heldByLaw = heldByLaw;
    }

    public String slug() {
      return slug;
    }

    /**
     * Whether a copy has to outlive its handling.
     *
     * <p>18 U.S.C. 2258A(h), as amended by the REPORT Act in 2024: a provider
     * that makes a CyberTipline report preserves the report and its contents for
     * one year. It was ninety days before that amendment, and the site says a
     * year because that is what the law now says.
     */
    public boolean heldByLaw() {
      return heldByLaw;
    }

    public static Category of(String raw) {
      if (raw == null) {
        return null;
      }
      String wanted = raw.strip();
      for (Category candidate : values()) {
        if (candidate.slug.equalsIgnoreCase(wanted) || candidate.name().equalsIgnoreCase(wanted)) {
          return candidate;
        }
      }
      return null;
    }
  }

  public enum Status {
    /** Received, nobody has looked yet. */
    NEW,
    /** Looked at, no filing owed. Safe to delete. */
    CLOSED,
    /** Passed to an authority. Kept a year from the filing. */
    FILED
  }

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 32)
  private Category category;

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
