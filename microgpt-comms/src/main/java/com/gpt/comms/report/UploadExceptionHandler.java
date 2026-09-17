package com.gpt.comms.report;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/**
 * A file over the cap is rejected by the servlet container before any controller
 * runs, and without this it reaches the browser as a bare 500. A report is about
 * a kilobyte, so somebody hitting this has attached the wrong thing — usually a
 * photo — and the sentence says so.
 */
@RestControllerAdvice
public class UploadExceptionHandler {

  @ExceptionHandler(MaxUploadSizeExceededException.class)
  ProblemDetail tooLarge(MaxUploadSizeExceededException ignored) {
    return ProblemDetail.forStatusAndDetail(
        HttpStatus.PAYLOAD_TOO_LARGE,
        "That file is far larger than a report. A report is a short text file the app wrote for you; "
            + "a photo or a screenshot cannot be accepted here.");
  }
}
