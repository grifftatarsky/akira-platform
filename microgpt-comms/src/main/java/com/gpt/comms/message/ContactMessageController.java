package com.gpt.comms.message;

import com.gpt.comms.message.dto.MessageReceipt;
import com.gpt.comms.message.dto.MessageSubmission;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * General intake for outpostmessaging.com.
 *
 * <p>Open to anyone and write-only, like the report endpoint beside it. This is
 * the only route to a person that the site publishes: there is no address on it,
 * because a form can refuse what a mailbox has to receive.
 */
@RestController
@RequestMapping("/messages")
@RequiredArgsConstructor
public class ContactMessageController {

  private final ContactMessageService service;

  @PostMapping(
      consumes = {MediaType.MULTIPART_FORM_DATA_VALUE, MediaType.APPLICATION_FORM_URLENCODED_VALUE})
  @ResponseStatus(HttpStatus.CREATED)
  public MessageReceipt submit(@Valid @ModelAttribute MessageSubmission form) {
    return service.accept(form);
  }
}
