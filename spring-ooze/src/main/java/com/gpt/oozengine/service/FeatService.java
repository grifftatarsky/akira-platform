package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.model.Feat;
import com.gpt.oozengine.model.dto.request.FeatRequest;
import com.gpt.oozengine.model.dto.response.FeatResponse;
import com.gpt.oozengine.repository.CatalogRepository;
import com.gpt.oozengine.repository.FeatRepository;
import com.gpt.oozengine.repository.HiddenContentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class FeatService extends AbstractCatalogService<Feat, FeatRequest, FeatResponse> {

  private final FeatRepository feats;
  private final HiddenContentRepository hidden;

  @Override
  protected CatalogRepository<Feat> repo() {
    return feats;
  }

  @Override
  protected HiddenContentRepository hiddenRepo() {
    return hidden;
  }

  @Override
  protected ContentType contentType() {
    return ContentType.FEAT;
  }

  @Override
  protected Feat instantiate() {
    return new Feat();
  }

  @Override
  protected void apply(FeatRequest r, Feat f) {
    f.setName(r.name());
    f.setCategory(r.category());
    f.setPrerequisite(r.prerequisite());
    f.setRepeatable(r.repeatable());
    f.setDescription(r.description());
  }

  @Override
  protected FeatResponse toResponse(Feat f) {
    return FeatResponse.from(f);
  }
}
