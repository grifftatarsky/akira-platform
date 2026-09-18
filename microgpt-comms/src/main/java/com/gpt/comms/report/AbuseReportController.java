package com.gpt.comms.report;

import com.gpt.comms.report.dto.ReportReceipt;
import com.gpt.comms.report.dto.ReportSubmission;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Abuse intake for outpostmessaging.com.
 *
 * <p>Open to anyone: somebody reporting abuse has no account here and must not
 * need one. Reading reports back is not offered at all — there is no GET — so the
 * only way to the material is the mail it sends and the database behind it.
 *
 * <p>The report arrives as text rather than as a file. The app copies it to the
 * clipboard and opens the form, so pasting is the shortest path there is, and a
 * form with no file input is a form that cannot be handed a photograph. The
 * parser still decides what is a report; this only decides what can be offered.
 */
@RestController
@RequestMapping("/reports")
@RequiredArgsConstructor
public class AbuseReportController {

  private final AbuseReportService service;

  @PostMapping(
      consumes = {MediaType.MULTIPART_FORM_DATA_VALUE, MediaType.APPLICATION_FORM_URLENCODED_VALUE})
  @ResponseStatus(HttpStatus.CREATED)
  public ReportReceipt submit(
      @RequestParam("report") String report, @Valid @ModelAttribute ReportSubmission form) {
    if (report.isBlank()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Paste the report the app copied for you.");
    }
    return service.accept(report, form);
  }
}
