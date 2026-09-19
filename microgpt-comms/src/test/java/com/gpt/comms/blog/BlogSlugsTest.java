package com.gpt.comms.blog;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("A post's address")
class BlogSlugsTest {

  @Test
  @DisplayName("is its title in lower case, words joined by single hyphens")
  void joinsWords() {
    assertThat(BlogSlugs.of("  Outpost 1.0: What's New?  ")).isEqualTo("outpost-1-0-what-s-new");
  }

  @Test
  @DisplayName("drops accents rather than letters")
  void foldsAccents() {
    assertThat(BlogSlugs.of("Café résumé")).isEqualTo("cafe-resume");
  }

  @Test
  @DisplayName("is empty when the title has nothing a URL can carry")
  void emptyWhenNothingLeft() {
    assertThat(BlogSlugs.of("✉️ — ✉️")).isEmpty();
    assertThat(BlogSlugs.of(null)).isEmpty();
  }

  @Test
  @DisplayName("fits its column, and never ends on a hyphen")
  void fitsTheColumn() {
    String slug = BlogSlugs.of("word ".repeat(60));
    assertThat(slug).hasSizeLessThanOrEqualTo(BlogSlugs.MAX_LENGTH).doesNotEndWith("-");
  }
}
