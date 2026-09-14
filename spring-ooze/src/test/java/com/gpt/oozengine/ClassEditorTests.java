package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.Activation;
import com.gpt.oozengine.constant.rules.ArmorCategory;
import com.gpt.oozengine.constant.rules.CasterProgression;
import com.gpt.oozengine.constant.rules.Skill;
import com.gpt.oozengine.constant.rules.UsesReset;
import com.gpt.oozengine.model.Vocation;
import com.gpt.oozengine.model.dto.request.ClassValueRequest;
import com.gpt.oozengine.model.dto.request.VocationFeatureRequest;
import com.gpt.oozengine.model.dto.request.VocationLevelRequest;
import com.gpt.oozengine.model.dto.request.VocationRequest;
import com.gpt.oozengine.model.dto.response.VocationLevelResponse;
import com.gpt.oozengine.model.dto.response.VocationResponse;
import com.gpt.oozengine.repository.VocationRepository;
import com.gpt.oozengine.service.VocationService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/**
 * The payload a class editor sends.
 *
 * <p>What is under test is the update strategy, which is two different keys for
 * two different reasons: a level is matched on its number, because a class
 * table's rows are edited in place and never created or destroyed; a feature is
 * matched on its id, because its identity is referenced. Getting either wrong is
 * silent — the class still saves, it just renumbers itself on every keystroke.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ClassEditorTests {

  @Autowired private VocationService vocations;
  @Autowired private VocationRepository repo;

  private UUID idOf(String name) {
    return repo.findByOwnerIdIsNull().stream()
        .filter(v -> v.getName().equals(name))
        .map(Vocation::getId)
        .findFirst()
        .orElseThrow(() -> new AssertionError("no class named " + name));
  }

  /** The class header, with whatever level table and features the test needs. */
  private static VocationRequest request(
      VocationResponse from,
      List<VocationLevelRequest> levels,
      List<VocationFeatureRequest> features) {
    return new VocationRequest(
        from.name(), from.likes(), from.complexity(), from.hitDie(),
        from.primaryAbilities(), from.savingThrowProficiencies(), from.skillOptions(),
        from.skillChoices(), from.armorTraining(), from.weaponProficiencies(),
        from.toolProficiencies(), from.startingEquipment(), from.casterProgression(),
        from.spellcastingAbility(), from.description(), levels, features);
  }

  private static List<VocationLevelRequest> levelsOf(VocationResponse v) {
    return v.levels().stream()
        .map(l -> new VocationLevelRequest(
            l.level(), l.proficiencyBonus(), l.featureSummary(), l.cantripsKnown(),
            l.preparedSpells(), l.spellSlots(),
            l.classValues().stream()
                .map(c -> new ClassValueRequest(c.getLabel(), c.getValue()))
                .toList()))
        .toList();
  }

  private static List<VocationFeatureRequest> featuresOf(VocationResponse v) {
    return v.features().stream()
        .map(f -> new VocationFeatureRequest(
            f.id(), f.name(), f.description(), f.vocationLevel(), f.subclassId(),
            f.activation(), f.usesReset()))
        .toList();
  }

  @Test
  @DisplayName("a class round-trips through the editor's payload unchanged")
  void roundTrips() {
    UUID base = idOf("Barbarian");
    UUID user = UUID.randomUUID();
    VocationResponse before = vocations.get(base, null);

    VocationResponse after =
        vocations.update(base, request(before, levelsOf(before), featuresOf(before)), user);
    try {
      assertThat(after.base()).isFalse();
      assertThat(after.levels()).hasSize(20);
      assertThat(after.features()).hasSameSizeAs(before.features());
      assertThat(after.hitDie()).isEqualTo(12);
      assertThat(after.armorTraining())
          .containsExactlyInAnyOrderElementsOf(before.armorTraining());

      VocationLevelResponse first = after.levels().getFirst();
      assertThat(first.proficiencyBonus()).isEqualTo(2);
      // The class's own columns keep the book's order, which a map would lose.
      assertThat(first.classValues())
          .extracting(c -> c.getLabel() + " " + c.getValue())
          .containsExactly("Rages 2", "Rage Damage +2", "Weapon Mastery 2");
    } finally {
      vocations.revert(base, user);
    }
  }

  @Test
  @DisplayName("editing a level edits the row rather than replacing the table")
  void levelsAreMatchedOnTheirNumber() {
    UUID base = idOf("Wizard");
    UUID user = UUID.randomUUID();
    VocationResponse before = vocations.get(base, null);

    // Save once so the override exists, then edit one row of it. The override
    // is what update() returns: reading the base id back gives the base row,
    // and its ids are not the ones the private copy now carries.
    VocationResponse override =
        vocations.update(base, request(before, levelsOf(before), featuresOf(before)), user);
    try {
      List<VocationLevelRequest> edited =
          levelsOf(override).stream()
              .map(l -> l.level() != 5 ? l
                  : new VocationLevelRequest(5, l.proficiencyBonus(), "Memorize Spell, and more",
                      6, 12, Map.of(1, 4, 2, 3, 3, 2), l.classValues()))
              .toList();

      VocationResponse saved =
          vocations.update(override.id(), request(override, edited, featuresOf(override)), user);

      assertThat(saved.levels()).hasSize(20);
      VocationLevelResponse five = saved.levels().get(4);
      assertThat(five.level()).isEqualTo(5);
      assertThat(five.featureSummary()).isEqualTo("Memorize Spell, and more");
      assertThat(five.cantripsKnown()).isEqualTo(6);
      assertThat(five.preparedSpells()).isEqualTo(12);
      // Every other row untouched.
      assertThat(saved.levels().get(19).preparedSpells()).isEqualTo(25);
    } finally {
      vocations.revert(base, user);
    }
  }

  @Test
  @DisplayName("a feature keeps its id across an edit, and a new one gets one")
  void featuresAreMatchedOnTheirId() {
    UUID base = idOf("Fighter");
    UUID user = UUID.randomUUID();
    VocationResponse before = vocations.get(base, null);
    VocationResponse override =
        vocations.update(base, request(before, levelsOf(before), featuresOf(before)), user);
    try {
      UUID secondWind =
          override.features().stream()
              .filter(f -> f.name().equals("Second Wind"))
              .findFirst()
              .orElseThrow()
              .id();

      List<VocationFeatureRequest> edited =
          new java.util.ArrayList<>(featuresOf(override).stream()
              .map(f -> f.id().equals(secondWind)
                  ? new VocationFeatureRequest(f.id(), f.name(), "My table's Second Wind.",
                      f.vocationLevel(), f.subclassId(), f.activation(), f.usesReset())
                  : f)
              .toList());
      edited.add(new VocationFeatureRequest(
          null, "Second Breath", "A homebrew feature.", 4, null, Activation.BONUS_ACTION,
          UsesReset.SHORT_REST));

      VocationResponse saved =
          vocations.update(override.id(), request(override, null, edited), user);

      assertThat(saved.features()).hasSize(override.features().size() + 1);
      assertThat(saved.features())
          .filteredOn(f -> f.name().equals("Second Wind"))
          .allSatisfy(
              f -> {
                assertThat(f.id()).isEqualTo(secondWind);
                assertThat(f.description()).isEqualTo("My table's Second Wind.");
              });
      assertThat(saved.features())
          .filteredOn(f -> f.name().equals("Second Breath"))
          .singleElement()
          .satisfies(
              f -> {
                assertThat(f.id()).isNotNull();
                assertThat(f.vocationLevel()).isEqualTo(4);
                assertThat(f.usesReset()).isEqualTo(UsesReset.SHORT_REST);
              });
      // Levels were not sent, so they are left alone rather than deleted.
      assertThat(saved.levels()).hasSize(20);
    } finally {
      vocations.revert(base, user);
    }
  }

  @Test
  @DisplayName("a rename that carries no level table keeps the class it copied")
  void copyOnWriteSurvivesAHeaderOnlyEdit() {
    UUID base = idOf("Rogue");
    UUID user = UUID.randomUUID();
    VocationResponse before = vocations.get(base, null);

    VocationResponse renamed =
        vocations.update(
            base,
            new VocationRequest(
                "Rogue (my table)", before.likes(), before.complexity(), before.hitDie(),
                before.primaryAbilities(), before.savingThrowProficiencies(),
                before.skillOptions(), before.skillChoices(), before.armorTraining(),
                before.weaponProficiencies(), before.toolProficiencies(),
                before.startingEquipment(), CasterProgression.NONE, null, before.description(),
                null, null),
            user);
    try {
      // The whole point of copy-on-write: a header edit must not produce a class
      // with no levels and no features.
      assertThat(renamed.name()).isEqualTo("Rogue (my table)");
      assertThat(renamed.levels()).hasSize(20);
      assertThat(renamed.features()).hasSameSizeAs(before.features());
      assertThat(renamed.levels().get(19).classValues())
          .extracting(c -> c.getValue())
          .containsExactly("10d6");
    } finally {
      vocations.revert(base, user);
    }
  }

  @Test
  @DisplayName("an empty spell slot is no slot, and a blank column is no column")
  void emptyCellsAreDropped() {
    UUID base = idOf("Cleric");
    UUID user = UUID.randomUUID();
    VocationResponse before = vocations.get(base, null);

    List<VocationLevelRequest> levels =
        List.of(new VocationLevelRequest(
            1, 2, "Spellcasting", 3, 4,
            // The book prints a dash, and a form sends a zero.
            Map.of(1, 2, 2, 0, 3, 0),
            List.of(new ClassValueRequest("Channel Divinity", "2"),
                    new ClassValueRequest("  ", "3"))));

    VocationResponse saved =
        vocations.update(base, request(before, levels, null), user);
    try {
      assertThat(saved.levels()).hasSize(1);
      assertThat(saved.levels().getFirst().spellSlots())
          .containsExactlyInAnyOrderEntriesOf(Map.of(1, 2));
      assertThat(saved.levels().getFirst().classValues())
          .extracting(c -> c.getLabel())
          .containsExactly("Channel Divinity");
      // Features were not sent, so the copy from the base survives.
      assertThat(saved.features()).hasSameSizeAs(before.features());
    } finally {
      vocations.revert(base, user);
    }
  }

  @Test
  @DisplayName("a Skill and an ability the header carries survive an edit")
  void headerFieldsRoundTrip() {
    UUID base = idOf("Bard");
    UUID user = UUID.randomUUID();
    VocationResponse before = vocations.get(base, null);

    VocationResponse saved =
        vocations.update(base, request(before, null, null), user);
    try {
      assertThat(saved.skillOptions()).hasSize(18).contains(Skill.STEALTH);
      assertThat(saved.skillChoices()).isEqualTo(3);
      assertThat(saved.armorTraining()).containsExactly(ArmorCategory.LIGHT);
      assertThat(saved.spellcastingAbility()).isEqualTo(Ability.CHARISMA);
      assertThat(saved.casterProgression()).isEqualTo(CasterProgression.FULL);
      assertThat(saved.startingEquipment()).contains("Leather Armor");
    } finally {
      vocations.revert(base, user);
    }
  }
}
