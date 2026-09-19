package com.gpt.comms.blog.model;

import java.util.Arrays;
import java.util.Locale;

/**
 * The tags a post can carry, in the site's own spelling.
 *
 * <p>A fixed list rather than free text, because the site offers them as filters
 * and a filter with one post under a misspelling is worse than no filter. The
 * slugs are a contract with outpost-site's src/data/blog.ts; BlogTagTest holds
 * this side of it.
 */
public enum BlogTag {
  RELEASE_NOTES("release-notes"),
  ROADMAP("roadmap"),
  ARTICLES("articles"),
  SECURITY("security"),
  OUTPOST("outpost"),
  BULLET("bullet");

  private final String slug;

  BlogTag(String slug) {
    this.slug = slug;
  }

  public String slug() {
    return slug;
  }

  public static BlogTag of(String raw) {
    if (raw == null) {
      return null;
    }
    String wanted = raw.trim();
    return Arrays.stream(values())
        .filter(tag -> tag.slug.equals(wanted) || tag.name().equals(wanted.toUpperCase(Locale.ROOT)))
        .findFirst()
        .orElse(null);
  }
}
