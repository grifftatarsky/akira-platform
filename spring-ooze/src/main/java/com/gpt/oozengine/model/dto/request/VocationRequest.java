package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.ArmorCategory;
import com.gpt.oozengine.constant.rules.CasterProgression;
import com.gpt.oozengine.constant.rules.Skill;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Set;

/**
 * A class, as much of it as a form can carry.
 *
 * <p>{@code levels} and {@code features} may be null, which means "leave them
 * alone" — a client renaming a class need not send twenty level rows back. A
 * new override still copies them from the class it shadows first, so omitting
 * them keeps them rather than losing them; see {@code VocationService}.
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
    String description,
    @Valid List<VocationLevelRequest> levels,
    @Valid List<VocationFeatureRequest> features) {}
