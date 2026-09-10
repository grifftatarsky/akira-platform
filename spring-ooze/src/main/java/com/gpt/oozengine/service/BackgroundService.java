package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.model.Background;
import com.gpt.oozengine.model.dto.request.BackgroundRequest;
import com.gpt.oozengine.model.dto.response.BackgroundResponse;
import com.gpt.oozengine.repository.BackgroundRepository;
import com.gpt.oozengine.repository.FeatRepository;
import com.gpt.oozengine.repository.CatalogRepository;
import com.gpt.oozengine.repository.HiddenContentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class BackgroundService
    extends AbstractCatalogService<Background, BackgroundRequest, BackgroundResponse> {

  private final BackgroundRepository backgrounds;
  private final HiddenContentRepository hidden;
  private final FeatRepository feats;

  @Override
  protected CatalogRepository<Background> repo() {
    return backgrounds;
  }

  @Override
  protected HiddenContentRepository hiddenRepo() {
    return hidden;
  }

  @Override
  protected ContentType contentType() {
    return ContentType.BACKGROUND;
  }

  @Override
  protected Background instantiate() {
    return new Background();
  }

  @Override
  protected void apply(BackgroundRequest r, Background b) {
    b.setName(r.name());
    b.setToolProficiencies(r.toolProficiencies());
    b.setEquipment(r.equipment());
    b.setDescription(r.description());
    b.setFeat(r.featId() == null ? null : feats.findById(r.featId()).orElse(null));
    b.setFeatNote(r.featNote());
    b.getAbilityScores().clear();
    if (r.abilityScores() != null) {
      b.getAbilityScores().addAll(r.abilityScores());
    }
    b.getSkillProficiencies().clear();
    if (r.skillProficiencies() != null) {
      b.getSkillProficiencies().addAll(r.skillProficiencies());
    }
  }

  @Override
  protected BackgroundResponse toResponse(Background b) {
    return BackgroundResponse.from(b);
  }
}
