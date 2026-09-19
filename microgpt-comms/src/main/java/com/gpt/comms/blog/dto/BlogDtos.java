package com.gpt.comms.blog.dto;

import com.gpt.comms.blog.model.BlogPost;
import com.gpt.comms.blog.model.BlogTag;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * What the blog reads and writes. Tags travel as their slugs in both directions, so the site and
 * the desk never see the enum's Java names.
 */
public final class BlogDtos {

  private BlogDtos() {}

  private static List<String> slugs(BlogPost post) {
    return post.getTags().stream().sorted().map(BlogTag::slug).toList();
  }

  /** A post in the public list: everything but the body. */
  public record PostSummary(
      String slug, String title, String byline, String summary, List<String> tags, Instant publishedAt) {

    public static PostSummary of(BlogPost post) {
      return new PostSummary(
          post.getSlug(),
          post.getTitle(),
          post.getByline(),
          post.getSummary(),
          slugs(post),
          post.getPublishedAt());
    }
  }

  /** One published post, whole. */
  public record Post(
      String slug,
      String title,
      String byline,
      String summary,
      List<String> tags,
      Instant publishedAt,
      Instant updatedAt,
      String body) {

    public static Post of(BlogPost post) {
      return new Post(
          post.getSlug(),
          post.getTitle(),
          post.getByline(),
          post.getSummary(),
          slugs(post),
          post.getPublishedAt(),
          post.getUpdatedAt(),
          post.getBody());
    }
  }

  /** A row on the desk, drafts included. */
  public record DeskPostRow(
      UUID id,
      String slug,
      String title,
      String byline,
      List<String> tags,
      Instant publishedAt,
      Instant updatedAt) {

    public static DeskPostRow of(BlogPost post) {
      return new DeskPostRow(
          post.getId(),
          post.getSlug(),
          post.getTitle(),
          post.getByline(),
          slugs(post),
          post.getPublishedAt(),
          post.getUpdatedAt());
    }
  }

  /** One post as the desk edits it. */
  public record DeskPost(
      UUID id,
      String slug,
      String title,
      String byline,
      String summary,
      List<String> tags,
      String body,
      Instant publishedAt,
      Instant updatedAt,
      long version) {

    public static DeskPost of(BlogPost post) {
      return new DeskPost(
          post.getId(),
          post.getSlug(),
          post.getTitle(),
          post.getByline(),
          post.getSummary(),
          slugs(post),
          post.getBody(),
          post.getPublishedAt(),
          post.getUpdatedAt(),
          post.getVersion());
    }
  }

  /** What the write form sends. The slug is optional: left blank, it is made from the title. */
  public record PostDraft(
      @NotBlank @Size(max = 200) String title,
      @NotBlank @Size(max = 100) String byline,
      @Size(max = 400) String summary,
      List<String> tags,
      @Size(max = 120) String slug,
      @NotBlank @Size(max = 200_000) String body) {}

  /** The tags on offer, in the order the site lists them. */
  public record TagOption(String slug) {

    public static List<TagOption> all() {
      return java.util.Arrays.stream(BlogTag.values()).map(tag -> new TagOption(tag.slug())).toList();
    }
  }
}
