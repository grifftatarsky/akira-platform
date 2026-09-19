package com.gpt.comms.blog.model;

import com.gpt.comms.model.BaseEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "blog_post")
@Getter
@Setter
public class BlogPost extends BaseEntity {

  @Column(nullable = false, unique = true, length = 120)
  private String slug;

  @Column(nullable = false, length = 200)
  private String title;

  @Column(nullable = false, length = 100)
  private String byline;

  @Column(length = 400)
  private String summary;

  @Column(nullable = false, columnDefinition = "TEXT")
  private String body;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "blog_post_tag", joinColumns = @JoinColumn(name = "post_id"))
  @Enumerated(EnumType.STRING)
  @Column(name = "tag", nullable = false, length = 32)
  private Set<BlogTag> tags = new LinkedHashSet<>();

  private Instant publishedAt;

  public boolean isPublished() {
    return publishedAt != null;
  }
}
