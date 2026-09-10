package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.model.Condition;
import com.gpt.oozengine.model.dto.request.ConditionRequest;
import com.gpt.oozengine.model.dto.response.ConditionResponse;
import com.gpt.oozengine.repository.CatalogRepository;
import com.gpt.oozengine.repository.ConditionRepository;
import com.gpt.oozengine.repository.HiddenContentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ConditionService
    extends AbstractCatalogService<Condition, ConditionRequest, ConditionResponse> {

  private final ConditionRepository conditions;
  private final HiddenContentRepository hidden;

  @Override
  protected CatalogRepository<Condition> repo() {
    return conditions;
  }

  @Override
  protected HiddenContentRepository hiddenRepo() {
    return hidden;
  }

  @Override
  protected ContentType contentType() {
    return ContentType.CONDITION;
  }

  @Override
  protected Condition instantiate() {
    return new Condition();
  }

  @Override
  protected void apply(ConditionRequest r, Condition c) {
    c.setName(r.name());
    c.setCode(r.code());
    c.setDescription(r.description());
  }

  @Override
  protected ConditionResponse toResponse(Condition c) {
    return ConditionResponse.from(c);
  }
}
