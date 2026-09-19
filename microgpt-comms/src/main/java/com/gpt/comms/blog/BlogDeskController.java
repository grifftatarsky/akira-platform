package com.gpt.comms.blog;

import com.gpt.comms.blog.dto.BlogDtos.DeskPost;
import com.gpt.comms.blog.dto.BlogDtos.DeskPostRow;
import com.gpt.comms.blog.dto.BlogDtos.PostDraft;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Writing the blog, at the desk. Behind {@code COMMS_DESK} with the rest of {@code /desk/**}. */
@RestController
@RequestMapping("/desk/posts")
@RequiredArgsConstructor
public class BlogDeskController {

  private final BlogPostRepository posts;
  private final BlogService blog;

  @GetMapping
  public List<DeskPostRow> list() {
    return posts.findAllByOrderByUpdatedAtDesc().stream().map(DeskPostRow::of).toList();
  }

  @GetMapping("/{id}")
  public DeskPost post(@PathVariable UUID id) {
    return posts
        .findById(id)
        .map(DeskPost::of)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No post under that reference."));
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public DeskPost create(@Valid @RequestBody PostDraft draft) {
    return blog.create(draft);
  }

  @PutMapping("/{id}")
  public DeskPost update(@PathVariable UUID id, @Valid @RequestBody PostDraft draft) {
    return blog.update(id, draft);
  }

  @PostMapping("/{id}/publish")
  public DeskPost publish(@PathVariable UUID id) {
    return blog.publish(id);
  }

  @PostMapping("/{id}/unpublish")
  public DeskPost unpublish(@PathVariable UUID id) {
    return blog.unpublish(id);
  }

  @DeleteMapping("/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable UUID id) {
    blog.delete(id);
  }
}
