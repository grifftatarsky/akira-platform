package com.gpt.comms.report;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.comms.message.model.ContactMessage;
import com.gpt.comms.report.model.AbuseReport;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The slugs are a contract with a repository this build cannot see.
 *
 * <p>outpost-site posts whatever is in src/data/intake.ts and no compiler joins
 * the two. A slug renamed on one side and not the other binds to null, which the
 * form then shows as "choose what kind of thing this is" on a selector the
 * reporter has already used. These lists are the fixed side of that.
 */
@DisplayName("The categories the forms post")
class CategoryTest {

  @Nested
  @DisplayName("A report")
  class Reports {

    @Test
    @DisplayName("names every kind the form offers, in the form's own spelling")
    void slugsMatchTheForm() {
      assertThat(Arrays.stream(AbuseReport.Category.values()).map(AbuseReport.Category::slug))
          .containsExactly(
              "child-sexual",
              "threat",
              "self-harm",
              "harassment",
              "intimate-images",
              "fraud",
              "hate",
              "other");
    }

    @Test
    @DisplayName("binds from the slug, and from nothing else")
    void bindsFromASlug() {
      assertThat(AbuseReport.Category.of("intimate-images"))
          .isEqualTo(AbuseReport.Category.INTIMATE_IMAGES);
      assertThat(AbuseReport.Category.of("INTIMATE_IMAGES"))
          .isEqualTo(AbuseReport.Category.INTIMATE_IMAGES);
      assertThat(AbuseReport.Category.of(" self-harm ")).isEqualTo(AbuseReport.Category.SELF_HARM);
      assertThat(AbuseReport.Category.of("something else")).isNull();
      assertThat(AbuseReport.Category.of(null)).isNull();
    }

    @Test
    @DisplayName("holds a copy by law in exactly one kind")
    void onlyOneIsHeld() {
      List<AbuseReport.Category> held =
          Arrays.stream(AbuseReport.Category.values()).filter(AbuseReport.Category::heldByLaw).toList();
      assertThat(held).containsExactly(AbuseReport.Category.CHILD_SEXUAL);
    }
  }

  @Nested
  @DisplayName("A message")
  class Messages {

    @Test
    @DisplayName("names every kind the contact form offers")
    void slugsMatchTheForm() {
      assertThat(Arrays.stream(ContactMessage.Category.values()).map(ContactMessage.Category::slug))
          .containsExactly(
              "question",
              "defect",
              "suggestion",
              "accessibility",
              "security",
              "privacy",
              "legal",
              "mistaken-ban",
              "other");
      assertThat(Arrays.stream(ContactMessage.Product.values()).map(ContactMessage.Product::slug))
          .containsExactly("outpost", "bullet", "site");
    }

    @Test
    @DisplayName("binds from the slug, and refuses anything else")
    void bindsFromASlug() {
      assertThat(ContactMessage.Product.of("bullet")).isEqualTo(ContactMessage.Product.BULLET);
      assertThat(ContactMessage.Category.of("privacy")).isEqualTo(ContactMessage.Category.PRIVACY);
      assertThat(ContactMessage.Product.of("watch")).isNull();
      assertThat(ContactMessage.Category.of("")).isNull();
    }
  }
}
