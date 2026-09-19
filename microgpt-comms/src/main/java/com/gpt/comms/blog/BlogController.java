package com.gpt.comms.blog;

import com.gpt.comms.blog.dto.BlogDtos.Post;
import com.gpt.comms.blog.dto.BlogDtos.PostSummary;
import com.gpt.comms.blog.dto.BlogDtos.TagOption;
import java.util.List;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The blog as anybody reads it: published posts only. Search, sorting and filtering happen on the
 * site, over the whole list, because there will be tens of posts and not thousands.
 */
@RestController
@RequestMapping("/blog")
@RequiredArgsConstructor
public class BlogController {

  private static final CacheControl SHORT = CacheControl.maxAge(60, TimeUnit.SECONDS).cachePublic();

  private final BlogPostRepository posts;

  @GetMapping("/posts")
  public ResponseEntity<List<PostSummary>> posts() {
    List<PostSummary> list =
        posts.findAllByPublishedAtIsNotNullOrderByPublishedAtDesc().stream().map(PostSummary::of).toList();
    return ResponseEntity.ok().cacheControl(SHORT).body(list);
  }

  @GetMapping("/posts/{slug}")
  public ResponseEntity<Post> post(@PathVariable String slug) {
    Post post =
        posts
            .findBySlugAndPublishedAtIsNotNull(slug)
            .map(Post::of)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No post at that address."));
    return ResponseEntity.ok().cacheControl(SHORT).body(post);
  }

  @GetMapping("/tags")
  public List<TagOption> tags() {
    return TagOption.all();
  }
}
