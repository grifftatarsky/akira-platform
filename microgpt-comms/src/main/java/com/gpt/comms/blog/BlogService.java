package com.gpt.comms.blog;

import com.gpt.comms.blog.dto.BlogDtos.DeskPost;
import com.gpt.comms.blog.dto.BlogDtos.PostDraft;
import com.gpt.comms.blog.model.BlogPost;
import com.gpt.comms.blog.model.BlogTag;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Writing the blog.
 *
 * <p>A published post's slug is its address, and somebody may have linked to it, so once a post is
 * out its slug changes only when the desk sends a new one on purpose — retitling it does not move
 * it. A draft's slug follows its title until then.
 */
@Service
@RequiredArgsConstructor
public class BlogService {

  private final BlogPostRepository posts;

  @Transactional
  public DeskPost create(PostDraft draft) {
    BlogPost post = new BlogPost();
    apply(post, draft);
    return DeskPost.of(posts.save(post));
  }

  @Transactional
  public DeskPost update(UUID id, PostDraft draft) {
    BlogPost post = find(id);
    apply(post, draft);
    return DeskPost.of(post);
  }

  @Transactional
  public DeskPost publish(UUID id) {
    BlogPost post = find(id);
    if (post.getPublishedAt() == null) {
      post.setPublishedAt(Instant.now());
    }
    return DeskPost.of(post);
  }

  @Transactional
  public DeskPost unpublish(UUID id) {
    BlogPost post = find(id);
    post.setPublishedAt(null);
    return DeskPost.of(post);
  }

  @Transactional
  public void delete(UUID id) {
    posts.delete(find(id));
  }

  private BlogPost find(UUID id) {
    return posts
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No post under that reference."));
  }

  private void apply(BlogPost post, PostDraft draft) {
    post.setTitle(draft.title().trim());
    post.setByline(draft.byline().trim());
    post.setSummary(blankToNull(draft.summary()));
    post.setBody(draft.body());
    post.getTags().clear();
    post.getTags().addAll(tags(draft.tags()));

    String asked = BlogSlugs.of(draft.slug());
    if (!asked.isEmpty()) {
      post.setSlug(unique(asked, post.getId()));
    } else if (post.getSlug() == null || !post.isPublished()) {
      post.setSlug(unique(BlogSlugs.of(draft.title()), post.getId()));
    }
  }

  private String unique(String base, UUID self) {
    String root = base.isEmpty() ? "post" : base;
    String candidate = root;
    for (int n = 2; takenByAnother(candidate, self); n++) {
      String suffix = "-" + n;
      int room = BlogSlugs.MAX_LENGTH - suffix.length();
      candidate = (root.length() > room ? root.substring(0, room) : root) + suffix;
    }
    return candidate;
  }

  private boolean takenByAnother(String slug, UUID self) {
    return posts.findBySlug(slug).map(other -> !other.getId().equals(self)).orElse(false);
  }

  private static Set<BlogTag> tags(List<String> raw) {
    Set<BlogTag> tags = EnumSet.noneOf(BlogTag.class);
    if (raw == null) {
      return tags;
    }
    for (String each : raw) {
      BlogTag tag = BlogTag.of(each);
      if (tag == null) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown tag: " + each);
      }
      tags.add(tag);
    }
    return tags;
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }
}
