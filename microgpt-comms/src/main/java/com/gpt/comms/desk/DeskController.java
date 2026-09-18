package com.gpt.comms.desk;

import com.gpt.comms.desk.dto.DeskDtos.CategoryGuide;
import com.gpt.comms.desk.dto.DeskDtos.Handling;
import com.gpt.comms.desk.dto.DeskDtos.HandlingResult;
import com.gpt.comms.desk.dto.DeskDtos.MessageDetail;
import com.gpt.comms.desk.dto.DeskDtos.MessageRow;
import com.gpt.comms.desk.dto.DeskDtos.ReportDetail;
import com.gpt.comms.desk.dto.DeskDtos.ReportRow;
import com.gpt.comms.message.ContactMessageRepository;
import com.gpt.comms.report.AbuseReportRepository;
import com.gpt.comms.report.model.AbuseReport;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The desk: reading what came in, and saying what was done about it.
 *
 * <p>Everything here is behind the {@code COMMS_DESK} authority — see
 * {@code security/AccessConfig}. It is the only part of this service that reads anything back, and
 * the reason the intake endpoints have no GET.
 */
@RestController
@RequestMapping("/desk")
@RequiredArgsConstructor
public class DeskController {

  private final AbuseReportRepository reports;
  private final ContactMessageRepository messages;
  private final DeskService desk;

  @GetMapping("/reports")
  public List<ReportRow> queue(@RequestParam(required = false) AbuseReport.Status status) {
    Instant now = Instant.now();
    List<AbuseReport> rows =
        status == null
            ? reports.findAllByOrderByCreatedAtAsc()
            : reports.findAllByStatusOrderByCreatedAtAsc(status);
    return rows.stream().map(report -> ReportRow.of(report, now)).toList();
  }

  @GetMapping("/reports/{id}")
  public ReportDetail report(@PathVariable UUID id) {
    return reports.findById(id).map(ReportDetail::of).orElseThrow(DeskController::gone);
  }

  @PostMapping("/reports/{id}/handle")
  public HandlingResult handle(@PathVariable UUID id, @Valid @RequestBody Handling handling) {
    return desk.handle(id, handling);
  }

  @PostMapping("/reports/{id}/release")
  public HandlingResult release(@PathVariable UUID id) {
    return desk.release(id);
  }

  @GetMapping("/messages")
  public List<MessageRow> messages() {
    return messages.findAll().stream()
        .sorted((a, b) -> a.getCreatedAt().compareTo(b.getCreatedAt()))
        .map(MessageRow::of)
        .toList();
  }

  @GetMapping("/messages/{id}")
  public MessageDetail message(@PathVariable UUID id) {
    return messages.findById(id).map(MessageDetail::of).orElseThrow(DeskController::gone);
  }

  @PostMapping("/messages/{id}/close")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void close(@PathVariable UUID id, @RequestParam(defaultValue = "true") boolean answered) {
    desk.close(id, answered);
  }

  @DeleteMapping("/messages/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void discard(@PathVariable UUID id) {
    desk.discard(id);
  }

  /** The routing, served from the same enum the public form posts. */
  @GetMapping("/guides")
  public List<CategoryGuide> guides() {
    return CategoryGuides.all();
  }

  private static ResponseStatusException gone() {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "Nothing here under that reference.");
  }
}
