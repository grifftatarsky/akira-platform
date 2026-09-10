package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.rules.ComponentMode;
import com.gpt.oozengine.model.mechanics.FeatureComponent;
import java.util.UUID;

/**
 * One thing a feature invokes: another of the creature's actions, a spell it
 * casts, or a standard action it takes.
 *
 * <p>Carries the target's name rather than the target, so a stat block's JSON
 * stays a tree — a Multiattack that embedded its Claw would embed the Claw's
 * steps and effects a second time, and one that embedded Fear would drag the
 * whole spell in.
 *
 * <p>{@link #targetKind} tells the client which of the three id fields is set
 * without it having to test each for null.
 */
public record FeatureComponentResponse(
    UUID id,
    Target targetKind,
    UUID referencedFeatureId,
    String referencedFeatureName,
    UUID referencedSpellId,
    String referencedSpellName,
    Integer spellLevel,
    UUID referencedActionId,
    String referencedActionName,
    int count,
    boolean optional,
    ComponentMode mode,
    Integer choiceGroup) {

  /** Which kind of thing this line points at. Exactly one is ever set. */
  public enum Target {
    FEATURE,
    SPELL,
    ACTION
  }

  public static FeatureComponentResponse from(FeatureComponent c) {
    var feature = c.getReferencedFeature();
    var spell = c.getReferencedSpell();
    var action = c.getReferencedAction();
    Target kind = feature != null ? Target.FEATURE : spell != null ? Target.SPELL : Target.ACTION;
    return new FeatureComponentResponse(
        c.getId(),
        kind,
        feature == null ? null : feature.getId(),
        feature == null ? null : feature.getName(),
        spell == null ? null : spell.getId(),
        spell == null ? null : spell.getName(),
        c.getSpellLevel(),
        action == null ? null : action.getId(),
        action == null ? null : action.getName(),
        c.getCount(),
        c.isOptional(),
        c.getMode(),
        c.getChoiceGroup());
  }
}
