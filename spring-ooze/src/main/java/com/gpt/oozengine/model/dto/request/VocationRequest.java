package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.ArmorCategory;
import com.gpt.oozengine.constant.rules.CasterProgression;
import com.gpt.oozengine.constant.rules.Skill;
import jakarta.validation.constraints.NotBlank;
import java.util.Set;

/**
 * A class, as much of it as a form can carry.
 *
 * <p>The level table and the features are not here: twenty rows of spell slots
 * and two dozen features are not something an edit form sends back, so a new
 * override copies them from the class it shadows instead — see
 * {@code VocationService.copyOnWrite}.
 */
public record VocationRequest(
    @NotBlank String name,
    String likes,
    String complexity,
    Integer hitDie,
    Set<Ability> primaryAbilities,
    Set<Ability> savingThrowProficiencies,
    Set<Skill> skillOptions,
    Integer skillChoices,
    Set<ArmorCategory> armorTraining,
    String weaponProficiencies,
    String toolProficiencies,
    String startingEquipment,
    CasterProgression casterProgression,
    Ability spellcastingAbility,
    String description) {}
