package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.model.GlossaryEntry;
import com.gpt.oozengine.model.dto.request.GlossaryEntryRequest;
import com.gpt.oozengine.model.dto.response.GlossaryEntryResponse;
import com.gpt.oozengine.repository.CatalogRepository;
import com.gpt.oozengine.repository.GlossaryEntryRepository;
import com.gpt.oozengine.repository.HiddenContentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class GlossaryEntryService
    extends AbstractCatalogService<GlossaryEntry, GlossaryEntryRequest, GlossaryEntryResponse> {

  private final GlossaryEntryRepository entries;
  private final HiddenContentRepository hidden;

  @Override
  protected CatalogRepository<GlossaryEntry> repo() {
    return entries;
  }

  @Override
  protected HiddenContentRepository hiddenRepo() {
    return hidden;
  }

  @Override
  protected ContentType contentType() {
    return ContentType.GLOSSARY;
  }

  @Override
  protected GlossaryEntry instantiate() {
    return new GlossaryEntry();
  }

  @Override
  protected void apply(GlossaryEntryRequest r, GlossaryEntry g) {
    g.setName(r.name());
    g.setCategory(r.category());
    g.setDescription(r.description());
  }

  @Override
  protected GlossaryEntryResponse toResponse(GlossaryEntry g) {
    return GlossaryEntryResponse.from(g);
  }
}
