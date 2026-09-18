package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.model.Trap;
import com.gpt.oozengine.model.dto.request.TrapRequest;
import com.gpt.oozengine.model.dto.response.TrapResponse;
import com.gpt.oozengine.repository.CatalogRepository;
import com.gpt.oozengine.repository.HiddenContentRepository;
import com.gpt.oozengine.repository.TrapRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class TrapService extends AbstractCatalogService<Trap, TrapRequest, TrapResponse> {

  private final TrapRepository traps;
  private final HiddenContentRepository hidden;

  @Override
  protected CatalogRepository<Trap> repo() {
    return traps;
  }

  @Override
  protected HiddenContentRepository hiddenRepo() {
    return hidden;
  }

  @Override
  protected ContentType contentType() {
    return ContentType.TRAP;
  }

  @Override
  protected Trap instantiate() {
    return new Trap();
  }

  @Override
  protected void apply(TrapRequest r, Trap t) {
    t.setName(r.name());
    t.setSeverity(r.severity());
    t.setLevelBand(r.levelBand());
    t.setSeverityNote(r.severityNote());
    t.setTrigger(r.trigger());
    t.setDuration(r.duration());
    t.setDescription(r.description());
  }

  @Override
  protected TrapResponse toResponse(Trap t) {
    return TrapResponse.from(t);
  }
}
