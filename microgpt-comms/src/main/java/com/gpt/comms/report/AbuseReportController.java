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
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import java.io.IOException;

/**
 * Abuse intake for outpostmessaging.com.
 *
 * <p>Open to anyone: somebody reporting abuse has no account here and must not
 * need one. Reading reports back is not offered at all — there is no GET — so the
 * only way to the material is the mail it sends and the database behind it.
 */
@RestController
@RequestMapping("/reports")
@RequiredArgsConstructor
public class AbuseReportController {

  private final AbuseReportService service;

  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  public ReportReceipt submit(
      @RequestPart("report") MultipartFile report, @Valid @ModelAttribute ReportSubmission form) {
    if (report.isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Attach the report the app gave you.");
    }
    byte[] bytes;
    try {
      bytes = report.getBytes();
    } catch (IOException unreadable) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "That file could not be read. Try attaching it again.");
    }
    return service.accept(bytes, form);
  }
}
