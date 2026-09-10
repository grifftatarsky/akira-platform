package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.rules.Ability;
import com.gpt.oozengine.constant.rules.ArmorCategory;
import com.gpt.oozengine.constant.rules.CasterProgression;
import com.gpt.oozengine.constant.rules.ComponentMode;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.constant.rules.ConditionCode;
import com.gpt.oozengine.constant.rules.GlossaryCategory;
import com.gpt.oozengine.constant.rules.ItemCategory;
import com.gpt.oozengine.constant.rules.PoisonType;
import com.gpt.oozengine.constant.rules.TrapSeverity;
import com.gpt.oozengine.constant.rules.Skill;
import com.gpt.oozengine.model.ClassValue;
import com.gpt.oozengine.model.GlossaryEntry;
import com.gpt.oozengine.model.Species;
import com.gpt.oozengine.model.Vocation;
import com.gpt.oozengine.model.VocationLevel;
import com.gpt.oozengine.model.mechanics.Feature;
import com.gpt.oozengine.repository.ConditionRepository;
import com.gpt.oozengine.repository.GlossaryEntryRepository;
import com.gpt.oozengine.repository.ItemRepository;
import com.gpt.oozengine.repository.SpeciesRepository;
import com.gpt.oozengine.repository.SubclassRepository;
import com.gpt.oozengine.repository.TrapRepository;
import com.gpt.oozengine.repository.VocationRepository;
import jakarta.persistence.EntityManager;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Sort;
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
  @Autowired private SpeciesRepository species;
  @Autowired private ItemRepository items;
  @Autowired private TrapRepository traps;
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
    // 036 adds 14 more from the Gameplay Toolbox.
    assertThat(entries).hasSize(154);
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

  @Test
  @DisplayName("species traits are named, and a trait's options are a choice")
  void speciesTraits() {
    var all = species.findByOwnerIdIsNull();
    assertThat(all).hasSize(9);

    long features =
        ((Number) em.createNativeQuery("select count(*) from features where species_id is not null")
                .getSingleResult())
            .longValue();
    // 33 traits, plus the 8 options nested inside two of them.
    assertThat(features).isEqualTo(41);

    Species dwarf =
        all.stream().filter(s -> s.getName().equals("Dwarf")).findFirst().orElseThrow();
    // Was one feature called "Dwarf Traits" with the whole entry in it.
    assertThat(dwarf.getFeatures())
        .extracting(Feature::getName)
        .containsExactly("Darkvision", "Dwarven Resilience", "Dwarven Toughness", "Stonecunning");
    assertThat(dwarf.getSize()).isEqualTo(CreatureSize.MEDIUM);
    assertThat(dwarf.getSpeeds()).containsEntry(MovementType.WALK, 30);

    Species human =
        all.stream().filter(s -> s.getName().equals("Human")).findFirst().orElseThrow();
    assertThat(human.getAlternateSize()).isEqualTo(CreatureSize.SMALL);
  }

  @Test
  @DisplayName("a Goliath picks one giant ancestry, not all six")
  void goliathAncestryIsAChoice() {
    Species goliath =
        species.findByOwnerIdIsNull().stream()
            .filter(s -> s.getName().equals("Goliath"))
            .findFirst()
            .orElseThrow();
    Feature ancestry =
        goliath.getFeatures().stream()
            .filter(f -> f.getName().equals("Giant Ancestry"))
            .findFirst()
            .orElseThrow();

    // The book sets the six in bold inside the trait that offers them, and you
    // take one. As siblings they would read as a Goliath with all six.
    assertThat(ancestry.getComponents()).hasSize(6);
    assertThat(ancestry.getComponents())
        .allSatisfy(
            c -> {
              assertThat(c.getMode()).isEqualTo(ComponentMode.CHOICE);
              assertThat(c.getCount()).isEqualTo(1);
              assertThat(c.getChoiceGroup()).isZero();
            });
    assertThat(ancestry.getComponents())
        .extracting(c -> c.getReferencedFeature().getName())
        .contains("Cloud's Jaunt (Cloud Giant)", "Storm's Thunder (Storm Giant)");
  }

  @Test
  @DisplayName("the toolbox's poisons are items, priced per dose")
  void poisons() {
    var poisons =
        items.findByOwnerIdIsNullAndItemCategory(ItemCategory.POISON, Sort.by("name"));

    assertThat(poisons).hasSize(14);
    assertThat(poisons).allSatisfy(
        p -> {
          assertThat(p.getCostGp()).isNotNull();
          assertThat(p.getPoisonType()).isNotNull();
          assertThat(p.getDescription()).isNotBlank();
        });
    var wyvern =
        poisons.stream().filter(p -> p.getName().equals("Wyvern Poison")).findFirst().orElseThrow();
    assertThat(wyvern.getCostGp()).isEqualByComparingTo("1200");
    assertThat(wyvern.getPoisonType()).isEqualTo(PoisonType.INJURY);
  }

  @Test
  @DisplayName("traps carry a severity, a trigger and a duration")
  void traps() {
    var all = traps.findByOwnerIdIsNull();

    assertThat(all).hasSize(8);
    assertThat(all).allSatisfy(
        t -> {
          assertThat(t.getSeverity()).isNotNull();
          assertThat(t.getTrigger()).isNotBlank();
          assertThat(t.getDescription()).isNotBlank();
        });

    var stone = all.stream().filter(t -> t.getName().equals("Rolling Stone")).findFirst()
        .orElseThrow();
    assertThat(stone.getSeverity()).isEqualTo(TrapSeverity.DEADLY);
    assertThat(stone.getLevelBand()).isEqualTo("11-16");
    // One trap is two: deadly to one tier, a nuisance to another. The severity
    // column can only hold the first, so the printed line is kept whole.
    assertThat(stone.getSeverityNote()).isEqualTo(
        "Deadly Trap (Levels 11-16) or Nuisance Trap (Levels 17-20)");
    assertThat(stone.getDuration()).isEqualTo("Until the stone stops rolling");
  }

  @Test
  @DisplayName("the toolbox's named rules join the glossary under their own categories")
  void toolboxReference() {
    var entries = glossary.findByOwnerIdIsNull();

    assertThat(entries)
        .filteredOn(e -> e.getCategory() == GlossaryCategory.ENVIRONMENT)
        .hasSize(9)
        .extracting(GlossaryEntry::getName)
        .contains("Extreme Cold", "Thin Ice", "High Altitude");
    assertThat(entries)
        .filteredOn(e -> e.getCategory() == GlossaryCategory.CONTAGION)
        .hasSize(3)
        .extracting(GlossaryEntry::getName)
        .containsExactlyInAnyOrder("Cackle Fever", "Sewer Plague", "Sight Rot");
    // 140 from the glossary chapter plus the 14 the toolbox contributes: 9
    // environmental effects, 3 contagions, and the two named sections whose
    // content is guidance — Fear Effects and Mental Stress Effects — which get
    // no category, like the book's own 114 untagged terms.
    assertThat(entries).hasSize(154);
    assertThat(entries)
        .extracting(GlossaryEntry::getName)
        .contains("Fear Effects", "Mental Stress Effects");
  }

  @Test
  @DisplayName("Legendary actions carry the once-per-round lock the prose states")
  void legendaryLockout() {
    // The 2024 stat blocks dropped "Costs 2 Actions" entirely — every legendary
    // action spends one use from the creature's pool — but half of them add
    // "can't take this action again until the start of its next turn" in prose
    // only. Parsed as AT_WILL, a dragon could spend all three uses on the same
    // action, so this asserts the prose was read.
    long legendary = count("select count(f) from Feature f where f.statBlockId is not null"
        + " and f.activation = com.gpt.oozengine.constant.rules.Activation.LEGENDARY");
    long locked = count("select count(f) from Feature f where f.statBlockId is not null"
        + " and f.usesReset = com.gpt.oozengine.constant.rules.UsesReset.PER_ROUND");
    // The phrase has to be the whole lockout sentence. "until the start of its
    // next turn" on its own is five times a condition's *duration* ("has the
    // Poisoned condition until the start of its next turn"), which is a
    // different thing that must not be read as a lock on the action.
    long stated = count("select count(f) from Feature f where f.statBlockId is not null"
        + " and lower(f.description) like"
        + " '%take this action again until the start of its next turn%'");

    assertThat(legendary).isEqualTo(82);
    assertThat(locked).isEqualTo(41).isEqualTo(stated);
    assertThat(count("select count(f) from Feature f where f.usesReset ="
        + " com.gpt.oozengine.constant.rules.UsesReset.PER_ROUND and f.usesMax <> 1")).isZero();
  }

  @Test
  @DisplayName("Regained hit points and forced movement are effects, not just prose")
  void healingAndForcedMovement() {
    // Both forms of healing: the wisp's "regains 10 (3d6) Hit Points" and the
    // troll's flat "regains 15 Hit Points". Only the dice form used to parse,
    // which silently dropped five of the nine.
    assertThat(count("select count(e) from Effect e where e.kind ="
        + " com.gpt.oozengine.constant.rules.EffectKind.HEALING")).isEqualTo(9);
    assertThat(count("select count(e) from Effect e where e.kind ="
        + " com.gpt.oozengine.constant.rules.EffectKind.HEALING and e.amount.count is null"))
        .isEqualTo(5);

    // Forced movement is not the target spending its own Speed, so movementType
    // — which names a speed — stays null and the verb rides in notes.
    // 56 now, not 8: forced movement (push/pull) was all this counted, and a
    // creature moving *itself* — teleport, jump, "moves up to half its Speed" —
    // is the same effect kind read from the other side of the sentence.
    assertThat(count("select count(e) from Effect e where e.kind ="
        + " com.gpt.oozengine.constant.rules.EffectKind.MOVEMENT")).isEqualTo(56);
    // A move is either a distance ("pushed 30 feet", "teleports up to 120
    // feet") or a speed ("moves up to half its Speed"). One of the two must be
    // there, or the effect says a creature moves without saying how far.
    assertThat(count("select count(e) from Effect e where e.kind ="
        + " com.gpt.oozengine.constant.rules.EffectKind.MOVEMENT"
        + " and e.movementFeet is null and e.movementType is null")).isZero();
  }

  @Test
  @DisplayName("A condition the book time-limits carries that limit")
  void conditionDurations() {
    // Nothing populated these columns before, so every condition the engine
    // applied would have lasted for the rest of the battle. 42 of the 246 say
    // how long they last; the remainder are open-ended in the book itself.
    // Both halves of "the Blinded and Poisoned conditions until the end of the
    // kraken's next turn" expire, which is why this moved with that fix.
    assertThat(count("select count(e) from Effect e where e.kind ="
        + " com.gpt.oozengine.constant.rules.EffectKind.APPLY_CONDITION"
        + " and e.durationAmount is not null")).isEqualTo(42);
    assertThat(count("select count(e) from Effect e where e.durationAmount is not null"
        + " and e.durationUnit is null")).isZero();
  }

  @Test
  @DisplayName("Damage with no dice, and two conditions in one sentence, both land")
  void flatDamageAndPluralConditions() {
    // "Hit: 1 Piercing damage" has no "(1d4)" for the dice pattern to find, so
    // 26 effects — every familiar and swarm component, plus a vampire's Running
    // Water and Sunlight — parsed with a to-hit bonus and nothing to apply.
    assertThat(count("select count(e) from Effect e where e.kind ="
        + " com.gpt.oozengine.constant.rules.EffectKind.DAMAGE"
        + " and e.amount.count is null and e.damageType is not null")).isEqualTo(26);

    // "has the Blinded and Poisoned conditions" is two conditions in one clause;
    // the singular pattern read neither. 13 features say it.
    assertThat(count("select count(e) from Effect e where e.kind ="
        + " com.gpt.oozengine.constant.rules.EffectKind.APPLY_CONDITION")).isEqualTo(246);
  }

  @Test
  @DisplayName("Every component resolves to exactly one feature, spell or action")
  void componentTargets() {
    // Scoped to seeded content — other tests in this suite save their own
    // stat blocks, and a homebrew Multiattack is not evidence about the book.
    assertThat(seededComponents("")).isEqualTo(491);
    assertThat(seededComponents("and c.references_feature_id is not null")).isEqualTo(387);
    assertThat(seededComponents("and c.references_spell_id is not null")).isEqualTo(78);
    // These resolve in 038 rather than 029: the glossary rows they point at are
    // only seeded in 033, and joining earlier silently dropped all 26.
    assertThat(seededComponents("and c.references_action_id is not null")).isEqualTo(26);
  }

  @Test
  @DisplayName("Riders give the book's third voice a mechanical form")
  void riders() {
    // 303 passive traits and 15 actions had no representation at all before
    // this: Pack Tactics attacked as though the creature stood alone.
    assertThat(count("select count(r) from Rider r")).isEqualTo(160);
    assertThat(count("select count(r) from Rider r where r.target ="
        + " com.gpt.oozengine.constant.rules.RiderTarget.ATTACK_ROLL")).isEqualTo(38);
    // Legendary Resistance is on all 32 legendary creatures and was the single
    // most consequential passive with no mechanical form. Its 3/Day already
    // parsed; what it spends a use on did not.
    assertThat(count("select count(r) from Rider r where r.mode ="
        + " com.gpt.oozengine.constant.rules.RiderMode.AUTO_SUCCEED")).isEqualTo(33);
    // The rust monster's corrosion is the book's only item-durability rule, and
    // it states both its destruction point and its cure, so both ride along.
    assertThat(count("select count(r) from Rider r where r.removedBy = 'Mending'")).isEqualTo(8);
    assertThat(count("select count(r) from Rider r where r.destroyedAt is not null"
        + " and r.removedBy is null")).isZero();
    // A BONUS with neither a flat amount nor dice would apply nothing.
    assertThat(count("select count(r) from Rider r where r.mode ="
        + " com.gpt.oozengine.constant.rules.RiderMode.BONUS"
        + " and r.amount is null and r.amountDice.count is null and r.gate is null")).isZero();
  }

  @Test
  @DisplayName("Shape-shifters carry their forms, and size is the live part")
  void shapeOptions() {
    assertThat(count("select count(s) from ShapeOption s")).isEqualTo(44);
    // 12 of the 14, not all: the incubus becomes a succubus and uses that stat
    // block instead, and the mimic's "returns to its true blob form" is phrased
    // so the true-form clause reads as part of the object form.
    assertThat(count("select count(distinct s.featureId) from ShapeOption s"
        + " where s.trueForm = true")).isEqualTo(12);
    // The quasit's bat is "Speed 10 ft., Fly 40 ft." — two speeds, one form.
    assertThat(count("select count(s) from ShapeOption s where size(s.speeds) > 0")).isEqualTo(8);
  }

  @Test
  @DisplayName("The two creatures the general mechanisms cannot reach are named")
  void uniqueBehaviour() {
    assertThat(count("select count(sb) from StatBlock sb"
        + " where sb.uniqueBehavior is not null")).isEqualTo(2);
    // A behaviour with no data is a handler with nothing to work on.
    assertThat(count("select count(sb) from StatBlock sb"
        + " where sb.uniqueBehavior is not null and sb.uniqueData is null")).isZero();
  }

  /**
   * Components on seeded monsters only. FeatureComponent maps no back-reference
   * to its owning feature — the join column lives on Feature's collection — so
   * this walks the tables rather than the object graph.
   */
  @Test
  @DisplayName("Every passive trait has a mechanical form, none is only prose")
  void everyPassiveIsRepresented() {
    // The claim this asserts: a simulator true to the table has to be able to
    // represent everything the book grants. 221 of 335 passives had no form at
    // all — a Pack Tactics creature attacked alone, an Amphibious one could not
    // be told it breathes water, Undead Fortitude never fired.
    long bare = ((Number) em.createNativeQuery("""
        select count(*) from features f
        join stat_blocks sb on sb.id = f.stat_block_id
        join monsters m on m.stat_block_id = sb.id
        where m.owner_id is null and f.activation = 'PASSIVE'
          and f.trigger_event is null and f.aura_size_feet is null
          and not exists (select 1 from feature_capabilities c where c.feature_id = f.id)
          and not exists (select 1 from feature_components fc where fc.feature_id = f.id)
          and not exists (select 1 from shape_options so where so.feature_id = f.id)
          and not exists (select 1 from effects e
                          join feature_steps st on st.id = e.step_id
                          where st.feature_id = f.id)
        """).getSingleResult()).longValue();
    assertThat(bare).isZero();
  }

  @Test
  @DisplayName("Capabilities carry their numbers, not just their names")
  void capabilities() {
    assertThat(count("select count(c) from FeatureCapability c")).isEqualTo(161);
    // Amphibious is the commonest trait in the bestiary.
    assertThat(count("select count(c) from FeatureCapability c where c.capability ="
        + " com.gpt.oozengine.constant.rules.Capability.BREATHE_AIR_AND_WATER")).isEqualTo(33);
    // Sixteen traits are genuinely narrative — a 30 percent chance of knowing
    // Wish, a GM's choice of dragon — and keep their prose against OTHER. That
    // number is the honest size of what no mechanism reaches, so it is asserted
    // rather than left to drift.
    assertThat(count("select count(c) from FeatureCapability c where c.capability ="
        + " com.gpt.oozengine.constant.rules.Capability.OTHER")).isEqualTo(16);
    // A capability that needs a number and lacks one says a frog jumps further
    // without saying how much further.
    assertThat(count("select count(c) from FeatureCapability c where c.capability in ("
        + " com.gpt.oozengine.constant.rules.Capability.HOLD_BREATH,"
        + " com.gpt.oozengine.constant.rules.Capability.DETECT_AT_RANGE,"
        + " com.gpt.oozengine.constant.rules.Capability.FIXED_JUMP_DISTANCE)"
        + " and c.amount is null")).isZero();
    // Every one keeps the book's wording so a DM can check our reading.
    assertThat(count("select count(c) from FeatureCapability c where c.notes is null")).isZero();
  }

  @Test
  @DisplayName("Triggered passives say when they fire, not just that they do")
  void triggers() {
    assertThat(count("select count(f) from Feature f where f.triggerEvent is not null"))
        .isEqualTo(95);
    // The Restoration family, on 33 fiends, celestials and undead.
    assertThat(count("select count(f) from Feature f where f.triggerEvent ="
        + " com.gpt.oozengine.constant.rules.TriggerEvent.ON_DEATH")).isEqualTo(33);
    // A damage-keyed trigger with no damage type would fire on everything.
    assertThat(count("select count(f) from Feature f where f.triggerEvent ="
        + " com.gpt.oozengine.constant.rules.TriggerEvent.ON_DAMAGE_TAKEN"
        + " and f.triggerDamageType is null")).isZero();
    // Every Reaction states its trigger in prose, and says so rather than
    // pretending to a classification it does not have.
    assertThat(count("select count(f) from Feature f where f.activation ="
        + " com.gpt.oozengine.constant.rules.Activation.REACTION"
        + " and f.triggerEvent <> com.gpt.oozengine.constant.rules.TriggerEvent"
        + ".DECLARED_BY_TRIGGER_TEXT")).isZero();
    // Auras are real geometry: the board gets asked what is inside them.
    assertThat(count("select count(f) from Feature f where f.auraSizeFeet is not null"))
        .isEqualTo(39);
  }

  private long seededComponents(String extra) {
    return ((Number) em.createNativeQuery("""
        select count(*) from feature_components c
        join features f on f.id = c.feature_id
        join stat_blocks sb on sb.id = f.stat_block_id
        join monsters m on m.stat_block_id = sb.id
        where m.owner_id is null """ + " " + extra)
        .getSingleResult()).longValue();
  }

  private long count(String jpql) {
    return em.createQuery(jpql, Long.class).getSingleResult();
  }
}
