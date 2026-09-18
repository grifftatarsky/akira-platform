package com.gpt.comms.message.dto;

import com.gpt.comms.message.model.ContactMessage;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** What the contact form posts. The email address is the only optional field. */
public record MessageSubmission(
    @NotNull(message = "Say which one this is about.") ContactMessage.Product product,
    @NotNull(message = "Choose what kind of thing this is.") ContactMessage.Category category,
    @NotBlank(message = "Give it a title — one line is enough.") @Size(max = 200) String title,
    @NotBlank(message = "Say what you want to say.")
        @Size(max = 8_000, message = "That is longer than this form accepts.")
        String description,
    @Email(message = "That email address does not look right.") @Size(max = 320) String email) {

  public MessageSubmission trimmed() {
    return new MessageSubmission(product, category, title.strip(), description.strip(), trim(email));
  }

  private static String trim(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.strip();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
