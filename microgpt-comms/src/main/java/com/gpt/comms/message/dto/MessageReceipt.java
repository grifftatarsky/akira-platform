package com.gpt.comms.message.dto;

import java.time.Instant;
import java.util.UUID;

/** What the contact form is told after a message is stored. */
public record MessageReceipt(UUID reference, Instant receivedAt) {}
