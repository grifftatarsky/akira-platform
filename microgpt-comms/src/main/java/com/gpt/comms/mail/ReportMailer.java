package com.gpt.comms.mail;

import com.gpt.comms.report.model.AbuseReport;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

/**
 * Tells a person that a report arrived.
 *
 * <p>The mail carries the report and never an attachment, because there is never
 * anything to attach — the intake refuses everything that is not the app's own
 * text. That is worth stating in the mail itself, which it does, so whoever reads
 * it knows without checking that nothing came with it.
 *
 * <p>Sending is best-effort and deliberately not transactional: the report is
 * already stored by the time this runs. A mail server that is down must not cost
 * somebody their report, so a failure here is logged and the submission still
 * succeeds. {@code notified_at} on the row is null until a mail actually goes,
 * which is what makes an unsent one findable afterwards.
 */
@Component
@Slf4j
public class ReportMailer {

  private static final DateTimeFormatter STAMP =
      DateTimeFormatter.ofPattern("d MMMM uuuu 'at' HH:mm:ss").withZone(ZoneOffset.UTC);

  private final JavaMailSender sender;
  private final String to;
  private final String from;
  private final String siteUrl;

  public ReportMailer(
      JavaMailSender sender,
      @Value("${comms.report.to}") String to,
      @Value("${comms.report.from}") String from,
      @Value("${comms.site-url}") String siteUrl) {
    this.sender = sender;
    this.to = to;
    this.from = from;
    this.siteUrl = siteUrl;
  }

  /** @return true if the mail was handed to the mail server. */
  public boolean send(AbuseReport report) {
    try {
      MimeMessage message = sender.createMimeMessage();
      MimeMessageHelper helper = new MimeMessageHelper(message, false, "UTF-8");
      helper.setTo(to);
      helper.setFrom(from);
      helper.setSubject(subject(report));
      /*
       * A reply goes to the reporter when they left an address, so answering is
       * one keystroke rather than a copy and paste. When they left a phone number
       * or a postal address instead, reply-to is left alone and the body carries
       * what they gave.
       */
      if (report.getContactEmail() != null) {
        helper.setReplyTo(report.getContactEmail());
      }
      helper.setText(body(report), false);
      sender.send(message);
      return true;
    } catch (MessagingException | MailException undelivered) {
      log.error(
          "comms: report {} is stored but the notification did not send", report.getId(), undelivered);
      return false;
    }
  }

  private String subject(AbuseReport report) {
    return "Abuse report [%s]: %s from %s"
        .formatted(report.getCategory().slug(), spoken(report), report.getSenderShortCode());
  }

  private String spoken(AbuseReport report) {
    return report.getKind() == AbuseReport.Kind.PHOTO ? "a photo" : "a message";
  }

  private String body(AbuseReport report) {
    StringBuilder out = new StringBuilder();

    out.append("A report came in through the form at ").append(siteUrl).append(".\n\n");
    out.append("Reference: ").append(report.getId()).append('\n');
    out.append("Received: ").append(STAMP.format(report.getCreatedAt())).append(" UTC\n");
    out.append("Category: ").append(report.getCategory().slug()).append('\n');

    out.append("\n── What the reporter wrote ──────────────────────────────\n\n");
    out.append(report.getAppDescription().strip()).append('\n');

    out.append("\n── How to reach them ───────────────────────────────────\n\n");
    line(out, "Name", report.getContactName());
    line(out, "Email", report.getContactEmail());
    line(out, "Phone", report.getContactPhone());
    line(out, "Address", report.getContactAddress());

    out.append("\n── What the app reported ───────────────────────────────\n\n");
    line(out, "Kind", spoken(report));
    line(out, "Sender fingerprint", report.getSenderFingerprint());
    line(out, "Sender short code", report.getSenderShortCode());
    line(out, "Sender display name", report.getSenderDisplayName());
    line(out, "Message ID", report.getMessageId());
    line(out, "Sent", STAMP.format(report.getSentAt()) + " UTC");
    line(out, "Reported in the app", STAMP.format(report.getReportedAt()) + " UTC");
    line(out, "App version", report.getAppVersion());

    out.append("\n────────────────────────────────────────────────────────\n\n");
    out.append(
        """
        Nothing is attached to this mail, and nothing could be. The form accepts \
        the app's own report, which is text, and refuses everything else — so no \
        reported photo or message ever reaches this mailbox or the server behind \
        the form.

        The report is stored under the reference above. If it is passed to an \
        authority, mark it FILED and it is kept a year — 18 U.S.C. 2258A(h) makes \
        that a year and not a choice for anything reported to the CyberTipline. \
        If it comes to nothing, mark it CLOSED and delete it.
        """);

    return out.toString();
  }

  private void line(StringBuilder out, String label, String value) {
    if (value != null && !value.isBlank()) {
      out.append(String.format("%-20s %s%n", label + ":", value.strip()));
    }
  }
}
