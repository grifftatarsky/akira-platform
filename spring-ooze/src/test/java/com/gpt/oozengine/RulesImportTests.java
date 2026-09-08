package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.ArmorCategory;
import com.gpt.oozengine.constant.rules.CasterProgression;
import com.gpt.oozengine.constant.rules.ConditionCode;
import com.gpt.oozengine.constant.rules.GlossaryCategory;
import com.gpt.oozengine.constant.rules.Skill;
import com.gpt.oozengine.model.ClassValue;
import com.gpt.oozengine.model.GlossaryEntry;
import com.gpt.oozengine.model.Vocation;
import com.gpt.oozengine.model.VocationLevel;
import com.gpt.oozengine.model.mechanics.Feature;
import com.gpt.oozengine.repository.ConditionRepository;
import com.gpt.oozengine.repository.GlossaryEntryRepository;
import com.gpt.oozengine.repository.SubclassRepository;
import com.gpt.oozengine.repository.VocationRepository;
import jakarta.persistence.EntityManager;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Rules Glossary and Classes imports, asserted as counts and as specific
 * rows — a parser that drops a table section still produces plausible output,
 * and every defect in this import was found by a number that didn't match.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@Transactional
class RulesImportTests {

  @Autowired private GlossaryEntryRepository glossary;
  @Autowired private ConditionRepository conditions;
  @Autowired private VocationRepository vocations;
  @Autowired private SubclassRepository subclasses;
  @Autowired private EntityManager em;

  private Vocation vocation(String name) {
    return vocations.findByOwnerIdIsNull().stream()
        .filter(v -> v.getName().equals(name))
        .findFirst()
        .orElseThrow(() -> new AssertionError("no class named " + name));
  }

  @Test
  @DisplayName("the glossary is the book's, minus the conditions that have their own table")
  void glossaryIsComplete() {
    var entries = glossary.findByOwnerIdIsNull();

    // 155 entries in the chapter; the 15 [Condition] ones are conditions rows.
    assertThat(entries).hasSize(140);
    assertThat(entries).allSatisfy(e -> assertThat(e.getDescription()).isNotBlank());
    assertThat(entries)
        .extracting(GlossaryEntry::getName)
        .contains("Difficult Terrain", "Cover", "Bloodied", "Concentration", "Grappling");

    Map<GlossaryCategory, Long> byCategory = new java.util.EnumMap<>(GlossaryCategory.class);
    for (GlossaryEntry e : entries) {
      if (e.getCategory() != null) {
        byCategory.merge(e.getCategory(), 1L, Long::sum);
      }
    }
    assertThat(byCategory)
        .containsEntry(GlossaryCategory.ACTION, 12L)
        .containsEntry(GlossaryCategory.HAZARD, 5L)
        .containsEntry(GlossaryCategory.AREA_OF_EFFECT, 6L)
        .containsEntry(GlossaryCategory.ATTITUDE, 3L);
  }

  @Test
  @DisplayName("conditions keep their ids and gain the book's own wording")
  void conditionTextRefreshed() {
    var prone =
        conditions.findByOwnerIdIsNull().stream()
            .filter(c -> c.getCode() == ConditionCode.PRONE)
            .findFirst()
            .orElseThrow();

    // The seed carried a hand-written summary. Refreshing on name rather than
    // reloading the table keeps the id every effect in the bestiary points at.
    assertThat(prone.getDescription()).contains("Your only movement options are to crawl");
    assertThat(conditions.findByOwnerIdIsNull()).hasSize(15);
  }

  @Test
  @DisplayName("every class arrives with its core traits and twenty levels")
  void classesAreComplete() {
    assertThat(vocations.findByOwnerIdIsNull()).hasSize(12);

    long levels =
        ((Number) em.createNativeQuery("select count(*) from vocation_levels").getSingleResult())
            .longValue();
    long features =
        ((Number) em.createNativeQuery("select count(*) from features where vocation_id is not null")
                .getSingleResult())
            .longValue();
    long subclassFeatures =
        ((Number) em.createNativeQuery("select count(*) from features where subclass_id is not null")
                .getSingleResult())
            .longValue();

    assertThat(levels).isEqualTo(12 * 20);
    assertThat(features).isEqualTo(232);
    assertThat(subclassFeatures).isEqualTo(58);
    assertThat(vocations.findByOwnerIdIsNull())
        .allSatisfy(
            v -> {
              assertThat(v.getHitDie()).isNotNull();
              assertThat(v.getPrimaryAbilities()).isNotEmpty();
              assertThat(v.getSavingThrowProficiencies()).hasSize(2);
              assertThat(v.getLevels()).hasSize(20);
              assertThat(v.getStartingEquipment()).isNotBlank();
            });
  }

  @Test
  @DisplayName("a martial class: core traits, escalating features, no spell slots")
  void barbarian() {
    Vocation barbarian = vocation("Barbarian");

    assertThat(barbarian.getHitDie()).isEqualTo(12);
    assertThat(barbarian.getPrimaryAbilities()).containsExactly(Ability.STRENGTH);
    assertThat(barbarian.getSavingThrowProficiencies())
        .containsExactlyInAnyOrder(Ability.STRENGTH, Ability.CONSTITUTION);
    assertThat(barbarian.getSkillChoices()).isEqualTo(2);
    assertThat(barbarian.getSkillOptions()).hasSize(6).contains(Skill.INTIMIDATION);
    assertThat(barbarian.getArmorTraining())
        .containsExactlyInAnyOrder(ArmorCategory.LIGHT, ArmorCategory.MEDIUM, ArmorCategory.SHIELD);
    assertThat(barbarian.getCasterProgression()).isEqualTo(CasterProgression.NONE);

    VocationLevel first = barbarian.getLevels().getFirst();
    assertThat(first.getProficiencyBonus()).isEqualTo(2);
    assertThat(first.getSpellSlots()).isEmpty();
    // The columns no other class has: kept as a label/value map rather than as
    // a migration per class.
    // A list, not a map: the order is the book's — Rages, then Rage Damage,
    // then Weapon Mastery — and a map comes back from the database unordered.
    assertThat(first.getClassValues())
        .extracting(ClassValue::getLabel)
        .containsExactly("Rages", "Rage Damage", "Weapon Mastery");
    assertThat(first.getClassValues())
        .extracting(ClassValue::getValue)
        .containsExactly("2", "+2", "2");
    assertThat(barbarian.getLevels().get(19).getClassValues().getFirst().getValue())
        .isEqualTo("6");
  }

  @Test
  @DisplayName("a full caster's spell slots are the resource pool, level by level")
  void wizardSlots() {
    Vocation wizard = vocation("Wizard");

    assertThat(wizard.getCasterProgression()).isEqualTo(CasterProgression.FULL);
    assertThat(wizard.getSpellcastingAbility()).isEqualTo(Ability.INTELLIGENCE);
    assertThat(wizard.getArmorTraining()).isEmpty();

    VocationLevel five = wizard.getLevels().get(4);
    assertThat(five.getLevel()).isEqualTo(5);
    assertThat(five.getSpellSlots()).containsExactlyInAnyOrderEntriesOf(Map.of(1, 4, 2, 3, 3, 2));
    assertThat(five.getCantripsKnown()).isEqualTo(4);
    assertThat(five.getPreparedSpells()).isEqualTo(9);
  }

  @Test
  @DisplayName("a subclass's features are the class's, tagged with the subclass")
  void subclassFeatures() {
    Vocation fighter = vocation("Fighter");
    UUID champion =
        subclasses.findAll().stream()
            .filter(s -> s.getName().equals("Champion"))
            .findFirst()
            .orElseThrow()
            .getId();

    assertThat(fighter.getFeatures()).hasSizeGreaterThan(15);
    // A subclass's features are the class's, tagged — so a character's feature
    // list is one query with an optional filter rather than two merged lists.
    assertThat(fighter.getFeatures())
        .filteredOn(f -> f.getSubclassId() != null)
        .hasSize(6)
        .allSatisfy(f -> assertThat(f.getSubclassId()).isEqualTo(champion));
    // The table's cell survives even where the feature heading doesn't repeat:
    // level 17 grants Action Surge a second time, and only the cell says so.
    assertThat(fighter.getLevels().get(16).getFeatureSummary()).contains("Action Surge (two uses)");
    assertThat(fighter.getFeatures())
        .extracting(Feature::getName)
        .contains("Action Surge", "Second Wind", "Improved Critical");
  }

  @Test
  @DisplayName("every spell the class lists resolves to a spell we hold")
  void spellListsResolve() {
    long links =
        ((Number) em.createNativeQuery("select count(*) from spell_vocations").getSingleResult())
            .longValue();
    long wizardSpells =
        ((Number) em.createNativeQuery(
                    """
                    select count(*) from spell_vocations sv
                    join vocations v on v.id = sv.vocation_id
                    where v.name = 'Wizard'
                    """)
                .getSingleResult())
            .longValue();

    // 875 names across eight casters, every one of them matching a seeded spell
    // — which is the check that both imports agree on what a spell is called.
    assertThat(links).isEqualTo(875);
    assertThat(wizardSpells).isEqualTo(217);
  }
}
