package com.gpt.comms.report;

import com.gpt.comms.mail.ReportMailer;
import com.gpt.comms.report.dto.ReportReceipt;
import com.gpt.comms.report.dto.ReportSubmission;
import com.gpt.comms.report.model.AbuseReport;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
@Slf4j
public class AbuseReportService {

  private final AbuseReportRepository repository;
  private final ReportParser parser;
  private final ReportMailer mailer;

  /**
   * Verify, store, then notify — in that order and not the other way round.
   *
   * <p>Verification happens before anything is written, so a file that is not a
   * report never reaches the database at all. Notification happens after the
   * write and outside the transaction's success: mail that does not send must
   * not roll back a report somebody took the trouble to make.
   */
  @Transactional
  public ReportReceipt accept(String pasted, ReportSubmission form) {
    ReportSubmission submission = form.trimmed();

    if (!submission.hasAContact()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "Give one way to reach you — a name, an email address, a phone number or an address. "
              + "A report nobody can reply to cannot be answered or passed on.");
    }

    ParsedReport parsed;
    try {
      parsed = parser.parse(pasted.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    } catch (ReportParser.NotAReport refused) {
      log.info("comms: refused a paste — {}", refused.getMessage());
      throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, refused.getMessage());
    }

    AbuseReport report = new AbuseReport();
    report.setCategory(submission.category());
    report.setWantsReply(submission.repliesWanted());
    report.setAppDescription(parsed.description());
    report.setKind(
        parsed.kind() == ParsedReport.Kind.PHOTO ? AbuseReport.Kind.PHOTO : AbuseReport.Kind.TEXT);
    report.setSenderFingerprint(parsed.senderFingerprint());
    report.setSenderShortCode(parsed.senderShortCode());
    report.setSenderDisplayName(parsed.senderDisplayName());
    report.setMessageId(parsed.messageId());
    report.setSentAt(parsed.sentAt());
    report.setReportedAt(parsed.reportedAt());
    report.setAppVersion(parsed.appVersion());
    report.setRawReport(parsed.raw());

    report.setContactName(submission.name());
    report.setContactEmail(submission.email());
    report.setContactPhone(submission.phone());
    report.setContactAddress(submission.address());

    AbuseReport saved = repository.save(report);

    if (mailer.send(saved)) {
      saved.setNotifiedAt(Instant.now());
    }

    log.info("comms: stored report {}", saved.getId());
    return new ReportReceipt(saved.getId(), saved.getCreatedAt());
  }
}
