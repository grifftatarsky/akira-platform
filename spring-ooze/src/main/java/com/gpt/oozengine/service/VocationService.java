package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.model.Vocation;
import com.gpt.oozengine.model.VocationLevel;
import com.gpt.oozengine.model.mechanics.Feature;
import com.gpt.oozengine.model.dto.request.VocationRequest;
import com.gpt.oozengine.model.dto.response.SubclassResponse;
import com.gpt.oozengine.model.dto.response.VocationResponse;
import com.gpt.oozengine.repository.CatalogRepository;
import com.gpt.oozengine.repository.HiddenContentRepository;
import com.gpt.oozengine.repository.SubclassRepository;
import com.gpt.oozengine.repository.VocationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class VocationService extends AbstractCatalogService<Vocation, VocationRequest, VocationResponse> {

  private final VocationRepository vocations;
  private final HiddenContentRepository hidden;
  private final SubclassRepository subclasses;

  @Override
  protected CatalogRepository<Vocation> repo() {
    return vocations;
  }

  @Override
  protected HiddenContentRepository hiddenRepo() {
    return hidden;
  }

  @Override
  protected ContentType contentType() {
    return ContentType.VOCATION;
  }

  @Override
  protected Vocation instantiate() {
    return new Vocation();
  }

  /**
   * A class's level table and its features are not in the request — twenty rows
   * of spell slots and two dozen features are not something an edit form sends
   * back — so a new override takes its copies from the base class.
   */
  @Override
  protected void copyOnWrite(Vocation base, Vocation override) {
    for (VocationLevel level : base.getLevels()) {
      VocationLevel copy = new VocationLevel();
      copy.setLevel(level.getLevel());
      copy.setProficiencyBonus(level.getProficiencyBonus());
      copy.setFeatureSummary(level.getFeatureSummary());
      copy.setCantripsKnown(level.getCantripsKnown());
      copy.setPreparedSpells(level.getPreparedSpells());
      copy.getSpellSlots().putAll(level.getSpellSlots());
      copy.getClassValues().addAll(level.getClassValues());
      override.getLevels().add(copy);
    }
    for (Feature f : base.getFeatures()) {
      Feature copy = new Feature();
      copy.setName(f.getName());
      copy.setDescription(f.getDescription());
      copy.setActivation(f.getActivation());
      copy.setUsesReset(f.getUsesReset());
      copy.setVocationLevel(f.getVocationLevel());
      // Deliberately not the subclass: that row belongs to the base class, and
      // pointing a private copy at it would let one DM's edit reach another's.
      override.addFeature(copy);
    }
  }

  @Override
  protected void apply(VocationRequest r, Vocation v) {
    v.setName(r.name());
    v.setLikes(r.likes());
    v.setComplexity(r.complexity());
    v.setHitDie(r.hitDie());
    v.setCasterProgression(r.casterProgression());
    v.setSpellcastingAbility(r.spellcastingAbility());
    v.setDescription(r.description());
    v.setSkillChoices(r.skillChoices());
    v.setWeaponProficiencies(r.weaponProficiencies());
    v.setToolProficiencies(r.toolProficiencies());
    v.setStartingEquipment(r.startingEquipment());
    replace(v.getPrimaryAbilities(), r.primaryAbilities());
    replace(v.getSavingThrowProficiencies(), r.savingThrowProficiencies());
    replace(v.getSkillOptions(), r.skillOptions());
    replace(v.getArmorTraining(), r.armorTraining());
  }

  /** Replaces a managed collection in place; clearing and re-adding keeps
   * Hibernate's orphan tracking happy where assigning a new set would not. */
  private static <T> void replace(java.util.Set<T> target, java.util.Set<T> source) {
    target.clear();
    if (source != null) {
      target.addAll(source);
    }
  }

  @Override
  protected VocationResponse toResponse(Vocation v) {
    return VocationResponse.from(
        v,
        subclasses.findByVocationIdOrderByNameAsc(v.getId()).stream().map(SubclassResponse::from).toList());
  }

  /**
   * List rows carry the class header only. The twenty level rows and two dozen
   * features are the bulk of a class and nobody reads them from a list.
   */
  @Override
  protected VocationResponse toListResponse(Vocation v) {
    return VocationResponse.summary(v);
  }
}
