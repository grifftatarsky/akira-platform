package com.gpt.comms.report;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/**
 * A request over the cap is rejected by the servlet container before any
 * controller runs, and without this it reaches the browser as a bare 500. The
 * form offers no file input at all, so anything this large is a direct POST
 * carrying something that is not a report.
 */
@RestControllerAdvice
public class UploadExceptionHandler {

  @ExceptionHandler(MaxUploadSizeExceededException.class)
  ProblemDetail tooLarge(MaxUploadSizeExceededException ignored) {
    return ProblemDetail.forStatusAndDetail(
        HttpStatus.PAYLOAD_TOO_LARGE,
        "That is far larger than a report. A report is a few lines of text the app wrote for you, "
            + "and there is nowhere here to put a photo or a screenshot.");
  }
}
