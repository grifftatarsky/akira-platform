package com.gpt.comms.blog;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.comms.blog.model.BlogTag;
import java.util.Arrays;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The tags are a contract with outpost-site's src/data/blog.ts, which offers them as filters and
 * which no compiler joins to this enum. A tag renamed here and not there is a filter that finds
 * nothing.
 */
@DisplayName("The blog's tags")
class BlogTagTest {

  @Test
  @DisplayName("are the site's filters, in the site's spelling and order")
  void slugsMatchTheSite() {
    assertThat(Arrays.stream(BlogTag.values()).map(BlogTag::slug))
        .containsExactly("release-notes", "roadmap", "articles", "security", "outpost", "bullet");
  }

  @Test
  @DisplayName("are read from a slug or a name, and nothing else")
  void readsSlugsAndNames() {
    assertThat(BlogTag.of("release-notes")).isEqualTo(BlogTag.RELEASE_NOTES);
    assertThat(BlogTag.of(" roadmap ")).isEqualTo(BlogTag.ROADMAP);
    assertThat(BlogTag.of("RELEASE_NOTES")).isEqualTo(BlogTag.RELEASE_NOTES);
    assertThat(BlogTag.of("release notes")).isNull();
    assertThat(BlogTag.of(null)).isNull();
  }
}
