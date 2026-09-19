package com.gpt.comms.blog;

import com.gpt.comms.blog.model.BlogPost;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BlogPostRepository extends JpaRepository<BlogPost, UUID> {

  Optional<BlogPost> findBySlug(String slug);

  Optional<BlogPost> findBySlugAndPublishedAtIsNotNull(String slug);

  List<BlogPost> findAllByPublishedAtIsNotNullOrderByPublishedAtDesc();

  List<BlogPost> findAllByOrderByUpdatedAtDesc();

  boolean existsBySlug(String slug);
}
