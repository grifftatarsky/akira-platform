package com.gpt.comms.blog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.gpt.comms.TestcontainersConfiguration;
import com.gpt.comms.blog.dto.BlogDtos.DeskPost;
import com.gpt.comms.blog.dto.BlogDtos.PostDraft;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.web.server.ResponseStatusException;

/**
 * Against a real Postgres, so Liquibase runs and {@code ddl-auto: validate} checks the entity
 * against the changeset before any of this does.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@DisplayName("Writing the blog")
class BlogServiceTest {

  @Autowired BlogService blog;
  @Autowired BlogPostRepository posts;

  @BeforeEach
  void empty() {
    posts.deleteAll();
  }

  private static PostDraft draft(String title, List<String> tags) {
    return new PostDraft(title, "Griff", null, tags, null, "Body.");
  }

  @Test
  @DisplayName("a draft's address follows its title, and is not read by the public list")
  void draftFollowsTitle() {
    DeskPost created = blog.create(draft("First light", List.of("roadmap")));
    assertThat(created.slug()).isEqualTo("first-light");
    DeskPost renamed = blog.update(created.id(), draft("Second light", List.of("roadmap")));
    assertThat(renamed.slug()).isEqualTo("second-light");
    assertThat(posts.findAllByPublishedAtIsNotNullOrderByPublishedAtDesc()).isEmpty();
  }

  @Test
  @DisplayName("a published post keeps its address when it is retitled")
  void publishedKeepsAddress() {
    DeskPost created = blog.create(draft("Outpost 1.0", List.of("release-notes", "outpost")));
    blog.publish(created.id());
    DeskPost renamed = blog.update(created.id(), draft("Outpost 1.0 is out", List.of("release-notes")));
    assertThat(renamed.slug()).isEqualTo("outpost-1-0");
    assertThat(renamed.tags()).containsExactly("release-notes");
    assertThat(posts.findBySlugAndPublishedAtIsNotNull("outpost-1-0")).isPresent();
  }

  @Test
  @DisplayName("publishing twice keeps the first date, and unpublishing takes it off the site")
  void publishOnce() {
    DeskPost created = blog.create(draft("Once", List.of()));
    DeskPost first = blog.publish(created.id());
    DeskPost again = blog.publish(created.id());
    assertThat(again.publishedAt()).isEqualTo(first.publishedAt());
    blog.unpublish(created.id());
    assertThat(posts.findBySlugAndPublishedAtIsNotNull("once")).isEmpty();
  }

  @Test
  @DisplayName("two posts with one title get two addresses")
  void uniqueAddresses() {
    assertThat(blog.create(draft("Same", List.of())).slug()).isEqualTo("same");
    assertThat(blog.create(draft("Same", List.of())).slug()).isEqualTo("same-2");
    assertThat(blog.create(draft("Same", List.of())).slug()).isEqualTo("same-3");
  }

  @Test
  @DisplayName("tags come back in the site's order, whatever order they were sent in")
  void tagOrder() {
    DeskPost created = blog.create(draft("Order", List.of("bullet", "release-notes", "security")));
    assertThat(created.tags()).containsExactly("release-notes", "security", "bullet");
  }

  @Test
  @DisplayName("a tag the site does not offer is refused, not dropped")
  void unknownTag() {
    assertThatThrownBy(() -> blog.create(draft("Nope", List.of("news"))))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("news");
    assertThat(posts.count()).isZero();
  }
}
