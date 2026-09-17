package com.gpt.comms.report;

import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Reads an Outpost abuse report and refuses anything that is not one.
 *
 * <p><b>Why this is strict about shape rather than about file type.</b> A content
 * type is whatever the browser was told to send, and an extension is whatever the
 * file was named. Neither says anything about the bytes. The one thing this
 * endpoint must never do is accept an image, because the whole reason abuse
 * intake moved off a mailbox is that the operator must not end up holding
 * material they are not equipped to hold. So the check is over the content: a
 * report is a small, entirely-textual document with a fixed set of labelled
 * lines, and anything that cannot be read that way is refused.
 *
 * <p>An image, a PDF, an archive or a video fails at the first gate — strict
 * UTF-8 decoding with control characters refused — because all of them carry
 * bytes no text document contains. A text file that is not a report fails at the
 * second: the labels are absent. A report with a mangled field fails at the
 * third: the fingerprints must be the right width of hex, the timestamps must
 * parse, and the kind must be one of exactly two phrases.
 *
 * <p>The grammar mirrors {@code AbuseReport.body} in the app
 * ({@code CarpenterKit/Safety/AbuseReport.swift}). If that changes, this must
 * change with it, and the tests here are written from its output.
 */
@Component
public class ReportParser {

  /** A real report is about a kilobyte. This is room for a long description and no more. */
  public static final int MAX_BYTES = 64 * 1024;

  private static final int MAX_DESCRIPTION = 8_000;

  private static final String HEADING = "What happened:";
  private static final String ASSURANCE = "This report carries no message content and no media.";

  private static final Pattern KIND =
      Pattern.compile("^Reported: (a photo|a text message)$", Pattern.MULTILINE);
  private static final Pattern FINGERPRINT =
      Pattern.compile(
          "^Sender fingerprint \\(SHA-256 of their identifier\\): ([0-9a-f]{64})$",
          Pattern.MULTILINE);
  private static final Pattern SHORT_CODE =
      Pattern.compile("^Sender short code: ([0-9A-F]{6})$", Pattern.MULTILINE);
  private static final Pattern DISPLAY_NAME =
      Pattern.compile(
          "^Sender's display name, as shown \\(chosen by them, unverified\\): (.{1,200})$",
          Pattern.MULTILINE);
  private static final Pattern MESSAGE_ID =
      Pattern.compile("^Message ID \\(entry hash\\): ([0-9a-f]{64})$", Pattern.MULTILINE);
  /*
   * The timestamps capture the whole line rather than a non-space run, so a
   * value that is not a timestamp at all still reaches Instant.parse and is
   * refused as an unreadable time. Matching \S+ instead made the line simply
   * not match, and the reporter was told the field was missing when it was
   * present and wrong — a worse sentence for somebody trying to fix it.
   */
  private static final Pattern SENT_AT =
      Pattern.compile("^Sent at: (.{1,60}) \\(UTC\\)$", Pattern.MULTILINE);
  private static final Pattern REPORTED_AT =
      Pattern.compile("^Reported at: (.{1,60}) \\(UTC\\)$", Pattern.MULTILINE);
  private static final Pattern APP_VERSION =
      Pattern.compile("^App version: ([0-9A-Za-z.\\-+ ()]{1,60})$", Pattern.MULTILINE);

  /**
   * @throws NotAReport with a sentence a person reading the form can act on. The
   *     message is shown to whoever uploaded the file, so it says what is wrong
   *     and what to do, never how the check works.
   */
  public ParsedReport parse(byte[] bytes) {
    if (bytes == null || bytes.length == 0) {
      throw new NotAReport("That file is empty.");
    }
    if (bytes.length > MAX_BYTES) {
      throw new NotAReport(
          "That file is far larger than a report. A report is a short text file the app wrote for you.");
    }

    String text = asText(bytes);

    if (!text.startsWith(HEADING)) {
      throw new NotAReport(
          "That does not look like a report from Outpost. Use the report the app gave you, "
              + "or describe what happened in the box below and leave the file out.");
    }
    if (!text.contains(ASSURANCE)) {
      throw new NotAReport(
          "That report is missing part of what the app writes. Send the file exactly as the app gave it to you.");
    }

    String kind = one(KIND, text, "what kind of thing was reported");
    Instant sentAt = instant(one(SENT_AT, text, "when the message was sent"), "when the message was sent");
    Instant reportedAt = instant(one(REPORTED_AT, text, "when the report was made"), "when the report was made");

    /*
     * The description is everything between the heading and the first labelled
     * line, and it is read from the top rather than by splitting on labels,
     * because a reporter can type anything at all — including a line that looks
     * like a label. Taking the structured tail as "from the first `Reported:`
     * onwards" is what keeps a quoted label in somebody's own words from
     * confusing the parse.
     */
    Matcher kindLine = KIND.matcher(text);
    if (!kindLine.find()) {
      throw new NotAReport("That report is missing what kind of thing was reported.");
    }
    String description = text.substring(HEADING.length(), kindLine.start()).trim();
    if (description.length() > MAX_DESCRIPTION) {
      description = description.substring(0, MAX_DESCRIPTION);
    }

    return new ParsedReport(
        description,
        kind.equals("a photo") ? ParsedReport.Kind.PHOTO : ParsedReport.Kind.TEXT,
        one(FINGERPRINT, text, "the sender's fingerprint"),
        one(SHORT_CODE, text, "the sender's short code"),
        optional(DISPLAY_NAME, text).orElse(null),
        one(MESSAGE_ID, text, "the message identifier"),
        sentAt,
        reportedAt,
        one(APP_VERSION, text, "the app version"),
        text);
  }

  /**
   * Strict UTF-8, and no control characters beyond tab, carriage return and
   * newline. This is the gate an image, a PDF, an archive or a video dies at:
   * every one of them carries bytes that are either invalid UTF-8 or a control
   * character, and a text document carries neither. A lenient decode would turn
   * those bytes into replacement characters and let a JPEG through as gibberish.
   */
  private String asText(byte[] bytes) {
    CharsetDecoder decoder =
        StandardCharsets.UTF_8
            .newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT);
    String text;
    try {
      CharBuffer decoded = decoder.decode(ByteBuffer.wrap(bytes));
      text = decoded.toString();
    } catch (CharacterCodingException notText) {
      throw new NotAReport(
          "That file is not a text report. Outpost writes its report as text; a photo, a screenshot "
              + "or a document cannot be accepted here.");
    }
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      if (Character.isISOControl(c) && c != '\n' && c != '\r' && c != '\t') {
        throw new NotAReport(
            "That file is not a text report. Outpost writes its report as text; a photo, a screenshot "
                + "or a document cannot be accepted here.");
      }
    }
    return text.replace("\r\n", "\n").strip();
  }

  private String one(Pattern pattern, String text, String what) {
    Matcher matcher = pattern.matcher(text);
    if (!matcher.find()) {
      throw new NotAReport("That report is missing " + what + ", or it has been edited.");
    }
    String value = matcher.group(matcher.groupCount() >= 1 ? 1 : 0).trim();
    if (matcher.find()) {
      throw new NotAReport("That report names " + what + " more than once.");
    }
    return value;
  }

  private Optional<String> optional(Pattern pattern, String text) {
    Matcher matcher = pattern.matcher(text);
    return matcher.find() ? Optional.of(matcher.group(1).trim()) : Optional.empty();
  }

  private Instant instant(String value, String what) {
    try {
      return Instant.parse(value);
    } catch (DateTimeParseException malformed) {
      throw new NotAReport("That report does not carry a readable time for " + what + ".");
    }
  }

  /** Refusal with a sentence meant for the person who uploaded the file. */
  public static class NotAReport extends RuntimeException {
    public NotAReport(String message) {
      super(message);
    }
  }
}
