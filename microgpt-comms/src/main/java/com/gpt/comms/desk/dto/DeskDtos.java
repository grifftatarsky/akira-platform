package com.gpt.comms.desk.dto;

import com.gpt.comms.handled.HandledRecord;
import com.gpt.comms.message.model.ContactMessage;
import com.gpt.comms.report.model.AbuseReport;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

/** Everything the desk reads and writes. Records, so the shape is the documentation. */
public final class DeskDtos {

  private DeskDtos() {}

  /** A row in the queue. Enough to triage, and not enough to read over somebody's shoulder. */
  public record ReportRow(
      UUID id,
      AbuseReport.Category category,
      AbuseReport.Status status,
      AbuseReport.Kind kind,
      Instant receivedAt,
      String senderShortCode,
      boolean hasContact,
      boolean wantsReply,
      Instant holdUntil,
      boolean releasable) {

    public static ReportRow of(AbuseReport report, Instant now) {
      Instant hold = report.getHoldUntil();
      return new ReportRow(
          report.getId(),
          report.getCategory(),
          report.getStatus(),
          report.getKind(),
          report.getCreatedAt(),
          report.getSenderShortCode(),
          report.getContactEmail() != null
              || report.getContactName() != null
              || report.getContactPhone() != null
              || report.getContactAddress() != null,
          report.isWantsReply(),
          hold,
          hold != null && !hold.isAfter(now));
    }
  }

  /** One report, opened. */
  public record ReportDetail(
      UUID id,
      AbuseReport.Category category,
      AbuseReport.Status status,
      AbuseReport.Kind kind,
      Instant receivedAt,
      String description,
      String senderFingerprint,
      String senderShortCode,
      String senderDisplayName,
      String messageId,
      Instant sentAt,
      Instant reportedAt,
      String appVersion,
      String contactName,
      String contactEmail,
      String contactPhone,
      String contactAddress,
      boolean wantsReply,
      Instant filedAt,
      String referredTo,
      Instant holdUntil,
      Instant repliedAt,
      Instant notifiedAt,
      String raw) {

    public static ReportDetail of(AbuseReport r) {
      return new ReportDetail(
          r.getId(), r.getCategory(), r.getStatus(), r.getKind(), r.getCreatedAt(),
          r.getAppDescription(), r.getSenderFingerprint(), r.getSenderShortCode(),
          r.getSenderDisplayName(), r.getMessageId(), r.getSentAt(), r.getReportedAt(),
          r.getAppVersion(), r.getContactName(), r.getContactEmail(), r.getContactPhone(),
          r.getContactAddress(), r.isWantsReply(), r.getFiledAt(), r.getReferredTo(),
          r.getHoldUntil(), r.getRepliedAt(), r.getNotifiedAt(), r.getRawReport());
    }
  }

  /** What the desk sends when a report has been dealt with. */
  public record Handling(
      @NotNull(message = "Say what was done with it.") HandledRecord.Outcome outcome,
      @Size(max = 200) String referredTo) {}

  /** What came back: what happened to the copy, said plainly, because the site promises it. */
  public record HandlingResult(
      UUID id,
      AbuseReport.Status status,
      boolean copyDeleted,
      boolean reporterTold,
      Instant holdUntil,
      String whatHappened) {}

  public record MessageRow(
      UUID id,
      ContactMessage.Product product,
      ContactMessage.Category category,
      ContactMessage.Status status,
      String title,
      Instant receivedAt,
      boolean canReply) {

    public static MessageRow of(ContactMessage m) {
      return new MessageRow(
          m.getId(), m.getProduct(), m.getCategory(), m.getStatus(), m.getTitle(),
          m.getCreatedAt(), m.getContactEmail() != null);
    }
  }

  public record MessageDetail(
      UUID id,
      ContactMessage.Product product,
      ContactMessage.Category category,
      ContactMessage.Status status,
      String title,
      String description,
      String contactEmail,
      Instant receivedAt,
      Instant notifiedAt) {

    public static MessageDetail of(ContactMessage m) {
      return new MessageDetail(
          m.getId(), m.getProduct(), m.getCategory(), m.getStatus(), m.getTitle(),
          m.getDescription(), m.getContactEmail(), m.getCreatedAt(), m.getNotifiedAt());
    }
  }

  /** The published routing for a category, served from the same enum the form posts. */
  public record CategoryGuide(
      String slug, String label, boolean heldByLaw, String retention, java.util.List<Step> steps) {

    public record Step(String name, String href, String note) {}
  }
}
