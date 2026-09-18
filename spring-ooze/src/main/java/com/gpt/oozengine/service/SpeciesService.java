package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.model.Species;
import com.gpt.oozengine.model.dto.request.SpeciesRequest;
import com.gpt.oozengine.model.dto.response.SpeciesResponse;
import com.gpt.oozengine.repository.CatalogRepository;
import com.gpt.oozengine.repository.HiddenContentRepository;
import com.gpt.oozengine.repository.SpeciesRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class SpeciesService extends AbstractCatalogService<Species, SpeciesRequest, SpeciesResponse> {

  private final SpeciesRepository species;
  private final HiddenContentRepository hidden;

  @Override
  protected CatalogRepository<Species> repo() {
    return species;
  }

  @Override
  protected HiddenContentRepository hiddenRepo() {
    return hidden;
  }

  @Override
  protected ContentType contentType() {
    return ContentType.SPECIES;
  }

  @Override
  protected Species instantiate() {
    return new Species();
  }

  @Override
  protected void apply(SpeciesRequest r, Species s) {
    s.setName(r.name());
    s.setSize(r.size());
    s.setAlternateSize(r.alternateSize());
    s.setCreatureType(r.creatureType());
    s.setDescription(r.description());
    if (r.walkSpeed() == null || r.walkSpeed() <= 0) {
      s.getSpeeds().remove(MovementType.WALK);
    } else {
      s.getSpeeds().put(MovementType.WALK, r.walkSpeed());
    }
  }

  @Override
  protected SpeciesResponse toResponse(Species s) {
    return SpeciesResponse.from(s);
  }
}
