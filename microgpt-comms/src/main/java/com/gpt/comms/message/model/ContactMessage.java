package com.gpt.comms.message.model;

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
 * Anything sent through the site that is not an abuse report.
 *
 * <p>It is a separate table from {@code abuse_report} rather than a column on it,
 * because the two are read in different orders, answered by different means and
 * kept for different lengths of time. A question about the App Store listing must
 * never sit in the same queue as something somebody was sent.
 *
 * <p>An email address is optional here and required nowhere. Somebody who leaves
 * none has said they do not want an answer, and that is honored: the row is read
 * and there is no way to reply to it.
 */
@Entity
@Table(name = "contact_message")
@Getter
@Setter
@NoArgsConstructor
public class ContactMessage extends BaseEntity {

  /** Which thing this is about. The site offers one form for all three. */
  public enum Product {
    OUTPOST("outpost"),
    BULLET("bullet"),
    SITE("site");

    private final String slug;

    Product(String slug) {
      this.slug = slug;
    }

    public String slug() {
      return slug;
    }

    public static Product of(String raw) {
      return raw == null ? null : find(raw.strip());
    }

    private static Product find(String wanted) {
      for (Product candidate : values()) {
        if (candidate.slug.equalsIgnoreCase(wanted) || candidate.name().equalsIgnoreCase(wanted)) {
          return candidate;
        }
      }
      return null;
    }
  }

  public enum Category {
    QUESTION("question"),
    DEFECT("defect"),
    SUGGESTION("suggestion"),
    ACCESSIBILITY("accessibility"),
    SECURITY("security"),
    PRIVACY("privacy"),
    LEGAL("legal"),
    OTHER("other");

    private final String slug;

    Category(String slug) {
      this.slug = slug;
    }

    public String slug() {
      return slug;
    }

    public static Category of(String raw) {
      return raw == null ? null : find(raw.strip());
    }

    private static Category find(String wanted) {
      for (Category candidate : values()) {
        if (candidate.slug.equalsIgnoreCase(wanted) || candidate.name().equalsIgnoreCase(wanted)) {
          return candidate;
        }
      }
      return null;
    }
  }

  public enum Status {
    NEW,
    ANSWERED,
    CLOSED
  }

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private Product product;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 32)
  private Category category;

  @Column(nullable = false, length = 200)
  private String title;

  @Column(nullable = false, length = 8_000)
  private String description;

  @Column(name = "contact_email", length = 320)
  private String contactEmail;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private Status status = Status.NEW;

  @Column(name = "notified_at")
  private Instant notifiedAt;
}
