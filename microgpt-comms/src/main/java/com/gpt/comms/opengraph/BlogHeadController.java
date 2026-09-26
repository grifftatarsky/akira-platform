package com.gpt.comms.opengraph;

import com.gpt.comms.blog.BlogPostRepository;
import com.gpt.comms.blog.model.BlogPost;
import com.gpt.comms.blog.model.BlogTag;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * A published post's {@code <head>}, for link previews. outpost-site's nginx serves the site's
 * {@code blog-post.html} for {@code /blog/<slug>} and includes this through SSI, so a crawler that
 * never runs the page still reads the post's own title, summary and card. An unpublished or unknown
 * slug answers 404 with no body, and nginx falls back to the blog's own head.
 *
 * <p>The tags mirror {@code head()} in outpost-site's {@code src/data/pages.ts}, including the
 * {@code data-head} attribute the page uses to replace them, and the cards' paths and sizes.
 */
@RestController
@RequiredArgsConstructor
public class BlogHeadController {

  static final String BLOG_DESCRIPTION =
      "What changed in Outpost and bullet, what is planned next, and longer pieces on how they work.";

  private static final CacheControl SHORT = CacheControl.maxAge(60, TimeUnit.SECONDS).cachePublic();

  private record Card(String path, int width, int height, String alt) {}

  private static final Card OUTPOST =
      new Card("/og/outpost.png", 1200, 630, "The Outpost logo: a mailbox with an antenna, and the word outpost.");
  private static final Card BULLET = new Card("/og/bullet.png", 1024, 1024, "The bullet wordmark.");

  private final BlogPostRepository posts;

  @Value("${app.public-origin:https://localhost}")
  private String publicOrigin;

  @GetMapping(path = "/blog/posts/{slug}/head", produces = MediaType.TEXT_HTML_VALUE)
  public ResponseEntity<String> head(@PathVariable String slug) {
    return posts
        .findBySlugAndPublishedAtIsNotNull(slug)
        .map(
            post ->
                ResponseEntity.ok()
                    .cacheControl(SHORT)
                    .contentType(new MediaType(MediaType.TEXT_HTML, StandardCharsets.UTF_8))
                    .body(render(post, AppStoreController.sanitizePublicOrigin(publicOrigin))))
        .orElseGet(() -> ResponseEntity.notFound().build());
  }

  static String render(BlogPost post, String origin) {
    String url = origin + "/blog/" + post.getSlug();
    String title = post.getTitle() + " — Outpost";
    String summary = post.getSummary();
    String description = summary == null || summary.isBlank() ? BLOG_DESCRIPTION : summary.strip();
    boolean bulletOnly = post.getTags().contains(BlogTag.BULLET) && !post.getTags().contains(BlogTag.OUTPOST);
    Card card = bulletOnly ? BULLET : OUTPOST;

    StringBuilder html = new StringBuilder();
    html.append("<title>").append(AppStoreController.escape(title)).append("</title>\n");
    for (List<String> tag :
        List.of(
            List.of("name", "description", description),
            List.of("property", "og:site_name", "Outpost"),
            List.of("property", "og:type", "article"),
            List.of("property", "og:title", title),
            List.of("property", "og:description", description),
            List.of("property", "og:url", url),
            List.of("property", "og:image", origin + card.path()),
            List.of("property", "og:image:width", String.valueOf(card.width())),
            List.of("property", "og:image:height", String.valueOf(card.height())),
            List.of("property", "og:image:alt", card.alt()),
            List.of("property", "article:published_time", post.getPublishedAt().toString()),
            List.of("name", "twitter:card", "summary_large_image"))) {
      html.append("    <meta ")
          .append(tag.get(0))
          .append("=\"")
          .append(AppStoreController.escape(tag.get(1)))
          .append("\" content=\"")
          .append(AppStoreController.escape(tag.get(2)))
          .append("\" data-head />\n");
    }
    html.append("    <link rel=\"canonical\" href=\"").append(AppStoreController.escape(url)).append("\" data-head />");
    return html.toString();
  }
}
