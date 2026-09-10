package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.model.Spell;
import com.gpt.oozengine.model.dto.request.SpellRequest;
import com.gpt.oozengine.model.dto.response.SpellResponse;
import com.gpt.oozengine.repository.CatalogRepository;
import com.gpt.oozengine.repository.HiddenContentRepository;
import com.gpt.oozengine.repository.SpellRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

/** Spell catalog. Override mechanics live in {@link AbstractCatalogService}. */
@Service
@RequiredArgsConstructor
public class SpellService extends AbstractCatalogService<Spell, SpellRequest, SpellResponse> {

  private final SpellRepository spells;
  private final HiddenContentRepository hidden;

  @Override
  protected CatalogRepository<Spell> repo() {
    return spells;
  }

  @Override
  protected HiddenContentRepository hiddenRepo() {
    return hidden;
  }

  @Override
  protected ContentType contentType() {
    return ContentType.SPELL;
  }

  @Override
  protected Spell instantiate() {
    return new Spell();
  }

  /** Spell lists read by level, then name — the order the book prints. */
  @Override
  protected Sort defaultSort() {
    return Sort.by(Sort.Order.asc("level"), Sort.Order.asc("name").ignoreCase());
  }
  @Override
  protected void apply(SpellRequest r, Spell s) {
    s.setName(r.name());
    s.setLevel(r.level());
    s.setSchool(r.school());
    s.setCastingTime(r.castingTime());
    s.setRange(r.range());
    s.setDuration(r.duration());
    s.setConcentration(r.concentration());
    s.setRitual(r.ritual());
    s.setVerbalComponent(r.verbalComponent());
    s.setSomaticComponent(r.somaticComponent());
    s.setMaterialComponent(r.materialComponent());
    s.setMaterials(r.materials());
    s.setDescription(r.description());
    s.setAtHigherLevels(r.atHigherLevels());
  }

  @Override
  protected SpellResponse toResponse(Spell s) {
    return SpellResponse.from(s);
  }
}
