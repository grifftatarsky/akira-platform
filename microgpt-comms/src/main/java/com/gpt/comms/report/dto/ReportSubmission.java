package com.gpt.comms.report.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The form beside the uploaded file.
 *
 * <p>Every contact field is optional on its own and {@link #hasAContact()} is
 * what the service requires: a report nobody can be reached about cannot be
 * answered, cannot be passed to an authority with the reporter attached, and
 * cannot be asked a follow-up question. Which of the four is given is the
 * reporter's choice, deliberately — a phone number suits somebody who does not
 * want to write, an address suits somebody with no phone, and insisting on an
 * email address would turn a safety form into an account.
 */
public record ReportSubmission(
    @NotBlank(message = "Say what happened, in your own words.")
        @Size(max = 8_000, message = "That description is longer than this form accepts.")
        String description,
    @Size(max = 200) String name,
    @Email(message = "That email address does not look right.") @Size(max = 320) String email,
    @Size(max = 60) String phone,
    @Size(max = 500) String address) {

  public boolean hasAContact() {
    return notBlank(name) || notBlank(email) || notBlank(phone) || notBlank(address);
  }

  private static boolean notBlank(String value) {
    return value != null && !value.isBlank();
  }

  public ReportSubmission trimmed() {
    return new ReportSubmission(
        trim(description), trim(name), trim(email), trim(phone), trim(address));
  }

  private static String trim(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.strip();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
