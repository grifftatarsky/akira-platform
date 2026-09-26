package com.gpt.comms.opengraph;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.comms.TestcontainersConfiguration;
import com.gpt.comms.blog.BlogPostRepository;
import com.gpt.comms.blog.BlogService;
import com.gpt.comms.blog.dto.BlogDtos.DeskPost;
import com.gpt.comms.blog.dto.BlogDtos.PostDraft;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/**
 * Over real HTTP with nobody signed in, because that is how nginx's SSI subrequest arrives, and
 * against a real Postgres, because only a published post may be described.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "app.public-origin=https://outpostmessaging.com")
@DisplayName("A post's head, for link previews")
class BlogHeadControllerTest {

  @Autowired BlogService blog;
  @Autowired BlogPostRepository posts;

  @Value("${local.server.port}")
  int port;

  private final HttpClient http = HttpClient.newHttpClient();

  @BeforeEach
  void empty() {
    posts.deleteAll();
  }

  private HttpResponse<String> head(String slug) throws Exception {
    return http.send(
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/blog/posts/" + slug + "/head")).build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private DeskPost published(String title, String summary, List<String> tags) {
    DeskPost post = blog.create(new PostDraft(title, "Griff", summary, tags, null, "Body."));
    return blog.publish(post.id());
  }

  @Test
  @DisplayName("a published post is described by its own title, summary, address and date")
  void published() throws Exception {
    published("Outpost 1.0", "What is in the first version.", List.of("release-notes", "outpost"));
    HttpResponse<String> response = head("outpost-1-0");
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.headers().firstValue("Content-Type")).hasValueSatisfying(type -> assertThat(type).startsWith("text/html"));
    assertThat(response.body())
        .contains("<title>Outpost 1.0 — Outpost</title>")
        .contains("<meta name=\"description\" content=\"What is in the first version.\" data-head />")
        .contains("<meta property=\"og:url\" content=\"https://outpostmessaging.com/blog/outpost-1-0\" data-head />")
        .contains("<link rel=\"canonical\" href=\"https://outpostmessaging.com/blog/outpost-1-0\" data-head />")
        .contains("<meta property=\"og:image\" content=\"https://outpostmessaging.com/og/outpost.png\" data-head />")
        .contains("<meta property=\"og:type\" content=\"article\" data-head />")
        .contains("article:published_time");
  }

  @Test
  @DisplayName("a draft and an unknown address answer 404 with no body, so nginx uses the blog's own head")
  void notPublished() throws Exception {
    blog.create(new PostDraft("Not yet", "Griff", "Secret.", List.of("roadmap"), null, "Body."));
    for (String slug : List.of("not-yet", "nothing-here")) {
      HttpResponse<String> response = head(slug);
      assertThat(response.statusCode()).isEqualTo(404);
      assertThat(response.body()).isEmpty();
    }
  }

  @Test
  @DisplayName("markup in a title or summary is escaped, and no summary falls back to the blog's")
  void escaped() throws Exception {
    published("<script>alert(1)</script> \"quoted\"", null, List.of("articles"));
    String body = head("script-alert-1-script-quoted").body();
    assertThat(body).doesNotContain("<script>").contains("&lt;script&gt;alert(1)&lt;/script&gt; &quot;quoted&quot;");
    assertThat(body).contains("content=\"" + BlogHeadController.BLOG_DESCRIPTION + "\"");
  }

  @Test
  @DisplayName("a post about bullet alone carries bullet's card")
  void bulletCard() throws Exception {
    published("bullet 0.2.0", "Sub-bullets.", List.of("release-notes", "bullet"));
    assertThat(head("bullet-0-2-0").body())
        .contains("<meta property=\"og:image\" content=\"https://outpostmessaging.com/og/bullet.png\" data-head />")
        .contains("<meta property=\"og:image:width\" content=\"1024\" data-head />");
  }
}
