package com.gpt.comms.message;

import com.gpt.comms.mail.MessageMailer;
import com.gpt.comms.message.dto.MessageReceipt;
import com.gpt.comms.message.dto.MessageSubmission;
import com.gpt.comms.message.model.ContactMessage;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Store, then notify.
 *
 * <p>Same order and the same reason as the report service: mail that does not
 * send must not roll back something somebody took the trouble to write.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ContactMessageService {

  private final ContactMessageRepository repository;
  private final MessageMailer mailer;

  @Transactional
  public MessageReceipt accept(MessageSubmission form) {
    MessageSubmission submission = form.trimmed();

    ContactMessage message = new ContactMessage();
    message.setProduct(submission.product());
    message.setCategory(submission.category());
    message.setTitle(submission.title());
    message.setDescription(submission.description());
    message.setContactEmail(submission.email());

    ContactMessage saved = repository.save(message);

    if (mailer.send(saved)) {
      saved.setNotifiedAt(Instant.now());
    }

    log.info("comms: stored message {}", saved.getId());
    return new MessageReceipt(saved.getId(), saved.getCreatedAt());
  }
}
