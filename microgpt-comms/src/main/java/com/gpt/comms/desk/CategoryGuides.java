package com.gpt.comms.desk;

import com.gpt.comms.desk.dto.DeskDtos.CategoryGuide;
import com.gpt.comms.report.model.AbuseReport.Category;
import java.util.List;
import java.util.Map;

/**
 * What to do with a report, by category.
 *
 * <p>These are operator steps and not the same text /resources publishes. That page tells a
 * reporter who they can contact themselves; this tells whoever is at the desk what they do, in
 * order, so a report at two in the morning does not depend on remembering. Where the two overlap —
 * which organization, which URL — they have to agree, and the slug list is pinned by a test on both
 * sides.
 */
public final class CategoryGuides {

  private CategoryGuides() {}

  private static final String HELD =
      "Held for one year from the filing, then deleted. 18 U.S.C. 2258A(h) — not a choice.";
  private static final String GONE =
      "Deleted as soon as this is handled. What stays is a line saying a report of this kind arrived.";

  private static CategoryGuide.Step step(String name, String href, String note) {
    return new CategoryGuide.Step(name, href, note);
  }

  private static final Map<Category, List<CategoryGuide.Step>> STEPS = Map.of(
      Category.CHILD_SEXUAL, List.of(
          step("File with the CyberTipline", "https://report.cybertip.org",
              "Do this first and do it today. As a provider you are required to report on actual "
                  + "knowledge, and the clock starts when you read it. Register as an ESP rather "
                  + "than filing as a member of the public."),
          step("Do not open, download or forward anything", "",
              "Nothing here contains media and the intake cannot accept any, which is the point. "
                  + "If a reporter offers to send you an image, refuse it and point them at the "
                  + "CyberTipline, which is equipped to receive it and you are not."),
          step("Preserve the report", "",
              "Marking it filed keeps the row for a year. Do not delete it, and do not edit it."),
          step("Tell the reporter what you can", "",
              "That it was reported to the national center, and that you cannot discuss the "
                  + "contents of that filing. Point them at Take It Down for image removal.")),
      Category.THREAT, List.of(
          step("Read it for immediacy first", "",
              "If it reads as a threat in progress, tell the reporter to call their local emergency "
                  + "number now. You are not the fastest route and should not act like one."),
          step("Refer to the reporter's local police", "",
              "A threat is prosecuted where the reporter is. You have no standing to make the "
                  + "report for them and should not try — give them what the app proved instead."),
          step("FBI IC3, where it crossed state lines", "https://www.ic3.gov",
              "For an online threat in the United States, particularly one that crossed a state "
                  + "line.")),
      Category.SELF_HARM, List.of(
          step("Do not contact anyone on their behalf", "",
              "The site says we do not, and that promise is the reason it can be trusted. The "
                  + "exception is a threat to life that reads as immediate, and then it is "
                  + "emergency services, not a referral."),
          step("Give them 988", "https://988lifeline.org",
              "Call or text 988 in the United States. Answered around the clock by people trained "
                  + "for it, which nobody at this desk is."),
          step("Answer quickly and briefly", "",
              "A short human reply that names the number beats a long one that arrives later.")),
      Category.HARASSMENT, List.of(
          step("Check they have blocked first", "",
              "Blocking takes effect immediately and takes nobody's agreement. If they have not, "
                  + "that is the most useful sentence in your reply."),
          step("Refer to their local police", "",
              "Stalking is a crime in every US state. A pattern matters more than any one message, "
                  + "so tell them to keep what they have rather than clear it."),
          step("SPARC, for documenting a pattern", "https://www.stalkingawareness.org",
              "How to document, and what to ask for."),
          step("The National DV Hotline, if they know the person",
              "https://www.thehotline.org", "1-800-799-7233.")),
      Category.INTIMATE_IMAGES, List.of(
          step("StopNCII, for an adult", "https://stopncii.org",
              "Fingerprints the image on their own device and shares only the hash. Say that out "
                  + "loud — people assume they have to send the picture somewhere."),
          step("Take It Down, if the person is under 18",
              "https://takeitdown.ncmec.org",
              "And re-read the report: if it describes a minor it belongs in the child category, "
                  + "not this one, and the obligations change."),
          step("Cyber Civil Rights Initiative", "https://cybercivilrights.org",
              "A helpline, and what the law is in their state.")),
      Category.FRAUD, List.of(
          step("Their bank comes before us", "",
              "If money has already moved, the bank is the only party who can stop it. Say that "
                  + "first, before anything else in the reply."),
          step("ReportFraud.ftc.gov", "https://reportfraud.ftc.gov",
              "Feeds the database law enforcement actually searches."),
          step("FBI IC3, for a wire or crypto", "https://www.ic3.gov",
              "Where speed changes the outcome.")),
      Category.HATE, List.of(
          step("Refer to their local police", "",
              "Whether it is a hate crime is a question for them, not for this desk. Do not "
                  + "characterize it in the reply.")),
      Category.OTHER, List.of(
          step("Read it against the other categories", "",
              "If it belongs in one of them, treat it as though that had been picked — the site "
                  + "says so. That includes the obligations."),
          step("Answer it", "", "Then close it.")));

  private static final Map<Category, String> LABELS = Map.of(
      Category.CHILD_SEXUAL, "Sexual content involving a child",
      Category.THREAT, "A threat of violence",
      Category.SELF_HARM, "Somebody describing harm to themselves",
      Category.HARASSMENT, "Harassment or stalking",
      Category.INTIMATE_IMAGES, "Intimate images shared without consent",
      Category.FRAUD, "Fraud or a scam",
      Category.HATE, "Hate directed at who somebody is",
      Category.OTHER, "Something else");

  public static CategoryGuide of(Category category) {
    return new CategoryGuide(
        category.slug(),
        LABELS.get(category),
        category.heldByLaw(),
        category.heldByLaw() ? HELD : GONE,
        STEPS.get(category));
  }

  public static List<CategoryGuide> all() {
    return java.util.Arrays.stream(Category.values()).map(CategoryGuides::of).toList();
  }
}
