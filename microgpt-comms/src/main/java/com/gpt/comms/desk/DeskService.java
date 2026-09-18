package com.gpt.comms.desk;

import com.gpt.comms.desk.dto.DeskDtos.Handling;
import com.gpt.comms.desk.dto.DeskDtos.HandlingResult;
import com.gpt.comms.handled.HandledRecord;
import com.gpt.comms.handled.HandledRecordRepository;
import com.gpt.comms.mail.ReporterMailer;
import com.gpt.comms.message.ContactMessageRepository;
import com.gpt.comms.message.model.ContactMessage;
import com.gpt.comms.report.AbuseReportRepository;
import com.gpt.comms.report.model.AbuseReport;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * What happens when somebody at the desk says a report is dealt with.
 *
 * <p>The order is the promise the site makes, in the order it makes it: tell the reporter, then
 * delete the copy. Never the other way round, and never the delete without the telling — a mail
 * server that is down means the row stays, because "we no longer hold it" is a sentence that has to
 * be true when it is read and not merely intended.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DeskService {

  private static final Duration STATUTORY_HOLD = Duration.ofDays(365);

  private final AbuseReportRepository reports;
  private final ContactMessageRepository messages;
  private final HandledRecordRepository handled;
  private final ReporterMailer mailer;

  @Transactional
  public HandlingResult handle(UUID id, Handling handling) {
    AbuseReport report = reports.findById(id).orElseThrow(DeskService::gone);

    if (report.getStatus() != AbuseReport.Status.NEW) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "That report has already been handled.");
    }
    boolean referred = handling.outcome() == HandledRecord.Outcome.REFERRED;
    if (referred && (handling.referredTo() == null || handling.referredTo().isBlank())) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Say who it was referred to. The reporter is told this.");
    }

    Instant now = Instant.now();
    boolean held = report.getCategory().heldByLaw();

    report.setStatus(referred ? AbuseReport.Status.FILED : AbuseReport.Status.CLOSED);
    report.setReferredTo(referred ? handling.referredTo().strip() : null);
    if (referred) {
      report.setFiledAt(now);
    }
    if (held) {
      report.setHoldUntil(now.plus(STATUTORY_HOLD));
    }

    boolean told = tellTheReporter(report, held, now);

    /*
     * A copy goes only when there is no legal hold and the reporter has been told, or had no
     * address to be told at. A reply that failed to send leaves the row standing.
     */
    boolean deletable = !held && (told || !canBeTold(report));
    if (deletable) {
      writeTheRecord(report, handling, now, now, told);
      reports.delete(report);
    } else {
      writeTheRecord(report, handling, now, null, told);
    }

    return new HandlingResult(
        id,
        report.getStatus(),
        deletable,
        told,
        report.getHoldUntil(),
        sentence(held, deletable, told, canBeTold(report)));
  }

  /**
   * Delete a copy whose statutory hold has run out.
   *
   * <p>Separate and manual on purpose. A year is long enough that a scheduled job quietly deleting
   * evidence is a worse failure than a row nobody got round to.
   */
  @Transactional
  public HandlingResult release(UUID id) {
    AbuseReport report = reports.findById(id).orElseThrow(DeskService::gone);
    Instant hold = report.getHoldUntil();

    if (hold == null) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "That report is not being held. Handle it instead.");
    }
    if (hold.isAfter(Instant.now())) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT,
          "That report is held until " + hold + " and deleting it early is not ours to do.");
    }

    HandledRecord record =
        handled.findByReportId(id).orElseThrow(() ->
            new ResponseStatusException(
                HttpStatus.CONFLICT,
                "There is no handling record for that report, so deleting it would lose the fact "
                    + "that it existed. Look at it before doing anything else."));
    record.setDeletedAt(Instant.now());
    reports.delete(report);

    return new HandlingResult(
        id, AbuseReport.Status.FILED, true, record.isReporterTold(), hold,
        "The hold has run out and the copy is deleted. The record of it staying.");
  }

  @Transactional
  public void close(UUID id, boolean answered) {
    ContactMessage message = messages.findById(id).orElseThrow(DeskService::gone);
    message.setStatus(answered ? ContactMessage.Status.ANSWERED : ContactMessage.Status.CLOSED);
  }

  @Transactional
  public void discard(UUID id) {
    ContactMessage message = messages.findById(id).orElseThrow(DeskService::gone);
    messages.delete(message);
  }

  private boolean canBeTold(AbuseReport report) {
    return report.isWantsReply()
        && report.getContactEmail() != null
        && !report.getContactEmail().isBlank();
  }

  private boolean tellTheReporter(AbuseReport report, boolean held, Instant now) {
    if (!canBeTold(report)) {
      return false;
    }
    if (!mailer.tell(report, held)) {
      log.error("comms: report {} handled but the reporter was not told", report.getId());
      return false;
    }
    report.setRepliedAt(now);
    return true;
  }

  private void writeTheRecord(
      AbuseReport report, Handling handling, Instant handledAt, Instant deletedAt, boolean told) {
    HandledRecord record = handled.findByReportId(report.getId()).orElseGet(HandledRecord::new);
    record.setReportId(report.getId());
    record.setCategory(report.getCategory());
    record.setOutcome(handling.outcome());
    record.setReferredTo(report.getReferredTo());
    record.setReceivedAt(report.getCreatedAt());
    record.setHandledAt(handledAt);
    record.setDeletedAt(deletedAt);
    record.setReporterTold(told);
    handled.save(record);
  }

  private String sentence(boolean held, boolean deleted, boolean told, boolean hadAnAddress) {
    if (held) {
      return "Held for a year from today, because the category requires it. Delete it after that "
          + "with Release, not before.";
    }
    if (deleted && told) {
      return "The reporter was told and the copy is deleted. What is left is the line saying a "
          + "report of this kind arrived and what was done.";
    }
    if (deleted) {
      return "The copy is deleted. There was no address to tell anybody at, which was their choice.";
    }
    if (hadAnAddress && !told) {
      return "The reply did not send, so the copy is still here. Fix the mail and handle it again "
          + "rather than deleting it by hand — the site says they are told before it goes.";
    }
    return "The copy is still here.";
  }

  private static ResponseStatusException gone() {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "Nothing here under that reference.");
  }
}
