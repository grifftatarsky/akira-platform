package com.gpt.comms.blog;

import java.text.Normalizer;
import java.util.Locale;

/** A title made into something a URL can carry: lower case, ASCII, words joined by hyphens. */
public final class BlogSlugs {

  public static final int MAX_LENGTH = 120;

  private BlogSlugs() {}

  public static String of(String raw) {
    if (raw == null) {
      return "";
    }
    String ascii =
        Normalizer.normalize(raw, Normalizer.Form.NFKD).replaceAll("\\p{M}+", "").toLowerCase(Locale.ROOT);
    String slug = ascii.replaceAll("[^a-z0-9]+", "-").replaceAll("(^-+)|(-+$)", "");
    if (slug.length() > MAX_LENGTH) {
      slug = slug.substring(0, MAX_LENGTH).replaceAll("-+$", "");
    }
    return slug;
  }
}
