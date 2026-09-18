package com.gpt.comms.mail;

import com.gpt.comms.message.model.ContactMessage;
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
 * Tells a person that something arrived through the contact form.
 *
 * <p>Best-effort, exactly as the report mailer is: the message is already stored
 * by the time this runs, and {@code notified_at} staying null is what makes an
 * unsent one findable later.
 */
@Component
@Slf4j
public class MessageMailer {

  private static final DateTimeFormatter STAMP =
      DateTimeFormatter.ofPattern("d MMMM uuuu 'at' HH:mm:ss").withZone(ZoneOffset.UTC);

  private final JavaMailSender sender;
  private final String to;
  private final String from;

  public MessageMailer(
      JavaMailSender sender,
      @Value("${comms.message.to}") String to,
      @Value("${comms.report.from}") String from) {
    this.sender = sender;
    this.to = to;
    this.from = from;
  }

  /** @return true if the mail was handed to the mail server. */
  public boolean send(ContactMessage message) {
    try {
      MimeMessage mime = sender.createMimeMessage();
      MimeMessageHelper helper = new MimeMessageHelper(mime, false, "UTF-8");
      helper.setTo(to);
      helper.setFrom(from);
      helper.setSubject(
          "[%s · %s] %s"
              .formatted(message.getProduct().slug(), message.getCategory().slug(), message.getTitle()));
      helper.setText(body(message));
      sender.send(mime);
      return true;
    } catch (MessagingException | MailException unsent) {
      log.error("comms: message {} stored but not mailed", message.getId(), unsent);
      return false;
    }
  }

  private String body(ContactMessage message) {
    return """
        %s
        %s

        About: %s
        Kind: %s
        Received: %s (UTC)
        Reference: %s

        %s

        Reply to: %s
        """
        .formatted(
            message.getTitle(),
            "=".repeat(Math.min(message.getTitle().length(), 72)),
            message.getProduct().slug(),
            message.getCategory().slug(),
            STAMP.format(message.getCreatedAt()),
            message.getId(),
            message.getDescription(),
            message.getContactEmail() == null
                ? "nothing given, so there is no way to answer this one"
                : message.getContactEmail());
  }
}
