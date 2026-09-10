package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.model.Monster;
import com.gpt.oozengine.model.creature.StatBlock;
import com.gpt.oozengine.model.dto.request.MonsterRequest;
import com.gpt.oozengine.model.dto.response.MonsterResponse;
import com.gpt.oozengine.repository.CatalogRepository;
import com.gpt.oozengine.repository.FeatureComponentRepository;
import com.gpt.oozengine.repository.HiddenContentRepository;
import com.gpt.oozengine.repository.MonsterRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class MonsterService extends AbstractCatalogService<Monster, MonsterRequest, MonsterResponse> {

  private final MonsterRepository monsters;
  private final StatBlockMapper statBlocks;
  private final HiddenContentRepository hidden;
  private final FeatureComponentRepository components;

  @Override
  protected CatalogRepository<Monster> repo() {
    return monsters;
  }

  @Override
  protected HiddenContentRepository hiddenRepo() {
    return hidden;
  }

  @Override
  protected ContentType contentType() {
    return ContentType.MONSTER;
  }

  @Override
  protected Monster instantiate() {
    return new Monster();
  }

  @Override
  protected void apply(MonsterRequest r, Monster m) {
    m.setName(r.name());
    m.setDescription(r.description());
    if (r.statBlock() == null) {
      return; // a rename or flavour edit: leave the mechanics alone
    }
    StatBlock s = m.getStatBlock();
    if (s == null) {
      s = new StatBlock();
      m.setStatBlock(s);
    }
    statBlocks.apply(r.statBlock(), s);
  }

  /**
   * Take a creature's Multiattack apart before deleting it — see
   * {@link FeatureComponentRepository#deleteForStatBlock}, which explains why
   * this cannot be left to the cascade.
   */
  @Override
  protected void beforeDelete(Monster m) {
    StatBlock block = m.getStatBlock();
    if (block == null) {
      return;
    }
    components.deleteForStatBlock(block.getId());
    // The rows are gone; drop them from the session too, or the delete that
    // follows tries to update rows that no longer exist.
    block.getFeatures().forEach(f -> f.getComponents().clear());
  }

  @Override
  protected MonsterResponse toResponse(Monster m) {
    return MonsterResponse.from(m);
  }

  /**
   * The bestiary is 330 creatures; with every stat block's features and effects
   * attached the list is over a megabyte, and the finder's list renders none of
   * it. Send the summary, and let opening a creature fetch the block.
   */
  @Override
  protected MonsterResponse toListResponse(Monster m) {
    return MonsterResponse.summary(m);
  }
}
