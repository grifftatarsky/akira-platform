package com.gpt.comms.mail;

import com.gpt.comms.report.model.AbuseReport;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

/**
 * The one mail that goes to the person who reported something.
 *
 * <p>It is sent before the copy is deleted and it says so, because the site promises it in those
 * words. If it does not send, the delete does not happen — {@code DeskService} keeps the row rather
 * than acting on a sentence nobody read.
 *
 * <p>No-reply is the sender because a reply here would land in a mailbox nobody watches, and the
 * whole arrangement rests on there being no such mailbox. The mail says where to go instead.
 */
@Component
@Slf4j
public class ReporterMailer {

  private final JavaMailSender sender;
  private final String from;
  private final String formUrl;
  private final String afterUrl;

  public ReporterMailer(
      JavaMailSender sender,
      @Value("${comms.reply.from}") String from,
      @Value("${comms.site-url}") String formUrl,
      @Value("${comms.after-url}") String afterUrl) {
    this.sender = sender;
    this.from = from;
    this.formUrl = formUrl;
    this.afterUrl = afterUrl;
  }

  /** @return true if the mail was handed to the mail server. */
  public boolean tell(AbuseReport report, boolean held) {
    try {
      MimeMessage mime = sender.createMimeMessage();
      MimeMessageHelper helper = new MimeMessageHelper(mime, false, "UTF-8");
      helper.setTo(report.getContactEmail());
      helper.setFrom(from);
      helper.setSubject("Your report has been dealt with");
      helper.setText(body(report, held));
      sender.send(mime);
      return true;
    } catch (MessagingException | MailException unsent) {
      log.error("comms: could not tell the reporter about {}", report.getId(), unsent);
      return false;
    }
  }

  private String body(AbuseReport report, boolean held) {
    StringBuilder out = new StringBuilder();

    out.append("Somebody read your report. This is what happened to it.\n\n");
    out.append("Reference: ").append(report.getId()).append("\n\n");

    if (report.getReferredTo() != null) {
      out.append("It was passed to ").append(report.getReferredTo()).append(".\n\n");
      if (held) {
        /*
         * The one case where the contents cannot be discussed. Saying that plainly is better than
         * a silence the reporter has to interpret.
         */
        out.append(
            """
            That referral is to the national center for reports of this kind, and what is in it \
            is not something we are able to discuss further. You can make your own report to them \
            directly at https://report.cybertip.org, and you can say more than we can.

            """);
      } else {
        out.append(
            """
            They will contact you directly if they need anything. We have given them the way to \
            reach you that you left with us and nothing else.

            """);
      }
    } else {
      out.append(
          """
          It did not turn out to be something an authority should see, so it has not been passed \
          to one. That is not a judgement about what happened to you — it is about what an agency \
          can act on.

          """);
    }

    if (held) {
      out.append(
          """
          Our copy is kept for one year from today. That is not a choice: the law that requires \
          the report also requires the wait. It is deleted at the end of it.
          """);
    } else {
      out.append(
          """
          Our copy is now deleted. What is left is a line recording that a report of this kind \
          arrived, when it was handled, and when it went — the fact of it, with none of its \
          contents and no way to reach you. We cannot look it up again, and neither can anybody \
          who asks us to.

          The machine takes a backup of itself every night and keeps three, so a deleted report \
          can survive in a backup for up to three more days before it is overwritten. That is the \
          honest number.
          """);
    }

    out.append("\n");
    out.append(
        """
        There is no way to add to a report once it is sent, and this address does not receive \
        mail. If something has changed, or if there is more, send a new one and say what the \
        first one said:

        """);
    out.append("  ").append(formUrl).append("\n\n");
    out.append(
        "The things you can do yourself — blocking, leaving a room, turning down what a banner\n"
            + "shows — all take effect immediately and take nobody's agreement. They are set out\n"
            + "at ")
        .append(afterUrl)
        .append(".\n");

    return out.toString();
  }
}
