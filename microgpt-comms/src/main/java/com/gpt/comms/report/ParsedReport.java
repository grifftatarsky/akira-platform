package com.gpt.comms.report;

import java.time.Instant;

/**
 * An Outpost abuse report that has been read and found to be one.
 *
 * <p>Every field here came out of {@link ReportParser}, so it is the app's own
 * account of what happened rather than anything the person filling in the form
 * typed. The two are kept apart on purpose: {@code description} below is the
 * app's, and the reporter's own words arrive separately on the form.
 *
 * @param raw the verified text, kept whole. It is plain text by construction —
 *     nothing else survives the parse — so keeping it costs nothing and means a
 *     report filed with an authority can be produced exactly as it was received.
 */
public record ParsedReport(
    String description,
    Kind kind,
    String senderFingerprint,
    String senderShortCode,
    String senderDisplayName,
    String messageId,
    Instant sentAt,
    Instant reportedAt,
    String appVersion,
    String raw) {

  public enum Kind {
    TEXT,
    PHOTO;

    public String spoken() {
      return this == PHOTO ? "a photo" : "a text message";
    }
  }
}
