package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.rules.Activation;
import com.gpt.oozengine.constant.rules.ComponentMode;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.CreatureType;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.constant.rules.UsesReset;
import com.gpt.oozengine.model.Monster;
import com.gpt.oozengine.model.mechanics.Feature;
import com.gpt.oozengine.model.dto.request.FeatureComponentRequest;
import com.gpt.oozengine.model.dto.request.FeatureRequest;
import com.gpt.oozengine.model.dto.request.MonsterRequest;
import com.gpt.oozengine.model.dto.request.StatBlockRequest;
import com.gpt.oozengine.model.dto.response.FeatureComponentResponse;
import com.gpt.oozengine.model.dto.response.FeatureResponse;
import com.gpt.oozengine.model.dto.response.MonsterResponse;
import com.gpt.oozengine.model.mechanics.FeatureComponent;
import com.gpt.oozengine.repository.MonsterRepository;
import com.gpt.oozengine.service.MonsterService;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;

/**
 * Multiattack as a plan rather than a sentence.
 *
 * <p>The subjects are chosen for the four ways the book combines lines, because
 * a parser that reads only the first one still looks right on two thirds of the
 * bestiary: a fixed list, a free combination, a replacement, and a whole
 * alternative plan.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class MultiattackTests {

  @Autowired private MonsterRepository monsters;
  @Autowired private MonsterService monsterService;
  @Autowired private EntityManager em;

  private static UUID featureId(MonsterResponse m, String feature) {
    return m.statBlock().features().stream()
        .filter(f -> f.name().equals(feature))
        .findFirst()
        .orElseThrow(() -> new AssertionError("no feature named " + feature))
        .id();
  }

  private Feature multiattackOf(String monster) {
    Monster m =
        monsters.findByOwnerIdIsNull().stream()
            .filter(x -> x.getName().equals(monster))
            .findFirst()
            .orElseThrow(() -> new AssertionError("no monster named " + monster));
    return m.getStatBlock().getFeatures().stream()
        .filter(f -> f.getName().toLowerCase(Locale.ROOT).startsWith("multiattack"))
        .findFirst()
        .orElseThrow(() -> new AssertionError(monster + " has no Multiattack"));
  }

  @Test
  @Transactional
  @DisplayName("every Multiattack in the book is structured, bar the one that counts heads")
  void everyMultiattackIsStructured() {
    // Scoped to base content: the claim is about the book, and a DM's homebrew
    // Multiattack is not evidence against it.
    long features =
        ((Number) em.createNativeQuery(
                    """
                    select count(*) from features f
                    join stat_blocks sb on sb.id = f.stat_block_id
                    join monsters m on m.stat_block_id = sb.id
                    where m.owner_id is null and f.name ilike 'Multiattack%'
                    """)
                .getSingleResult())
            .longValue();
    long withComponents =
        ((Number) em.createNativeQuery(
                    """
                    select count(distinct c.feature_id) from feature_components c
                    join features f on f.id = c.feature_id
                    join stat_blocks sb on sb.id = f.stat_block_id
                    join monsters m on m.stat_block_id = sb.id
                    where m.owner_id is null
                    """)
                .getSingleResult())
            .longValue();
    long components =
        ((Number) em.createNativeQuery(
                    """
                    select count(*) from feature_components c
                    join features f on f.id = c.feature_id
                    join stat_blocks sb on sb.id = f.stat_block_id
                    join monsters m on m.stat_block_id = sb.id
                    where m.owner_id is null
                    """)
                .getSingleResult())
            .longValue();

    assertThat(features).isEqualTo(178);
    assertThat(components).isEqualTo(324);
    // The Hydra's "as many Bite attacks as it has heads" has no fixed count, and
    // reading one off its Multiple Heads trait would be our number, not the
    // book's. Its sentence is still in the description.
    assertThat(withComponents).isEqualTo(177);
  }

  @Test
  @Transactional
  @DisplayName("a fixed list: two Tentacle attacks, then a choice of two spells")
  void aboleth() {
    List<FeatureComponent> parts = multiattackOf("Aboleth").getComponents();

    assertThat(parts).hasSize(3);
    assertThat(parts.get(0).getReferencedFeature().getName()).isEqualTo("Tentacle");
    assertThat(parts.get(0).getCount()).isEqualTo(2);
    assertThat(parts.get(0).getMode()).isEqualTo(ComponentMode.FIXED);
    // "uses either Consume Memories or Dominate Mind if available" — one of the
    // two, and only if the recharge allows it.
    assertThat(parts.subList(1, 3))
        .allSatisfy(
            c -> {
              assertThat(c.getMode()).isEqualTo(ComponentMode.CHOICE);
              assertThat(c.getCount()).isEqualTo(1);
              assertThat(c.isOptional()).isTrue();
            });
    assertThat(parts.get(1).getChoiceGroup()).isEqualTo(parts.get(2).getChoiceGroup());
  }

  @Test
  @Transactional
  @DisplayName("a free combination is three attacks total, not three of each")
  void assassin() {
    List<FeatureComponent> parts = multiattackOf("Assassin").getComponents();

    assertThat(parts).hasSize(2);
    assertThat(parts)
        .extracting(c -> c.getReferencedFeature().getName())
        .containsExactly("Shortsword", "Light Crossbow");
    // The distinction the mode exists for: without it these same rows read as
    // three Shortsword attacks *and* three Light Crossbow attacks.
    assertThat(parts).allSatisfy(c -> assertThat(c.getMode()).isEqualTo(ComponentMode.CHOICE));
    assertThat(parts).allSatisfy(c -> assertThat(c.getCount()).isEqualTo(3));
    assertThat(parts.get(0).getChoiceGroup()).isEqualTo(parts.get(1).getChoiceGroup());
  }

  @Test
  @Transactional
  @DisplayName("a replacement swaps an attack out rather than adding one")
  void adultBlackDragon() {
    List<FeatureComponent> parts = multiattackOf("Adult Black Dragon").getComponents();

    assertThat(parts).hasSize(2);
    assertThat(parts.get(0).getReferencedFeature().getName()).isEqualTo("Rend");
    assertThat(parts.get(0).getCount()).isEqualTo(3);
    assertThat(parts.get(1).getReferencedFeature().getName()).isEqualTo("Spellcasting");
    assertThat(parts.get(1).getMode()).isEqualTo(ComponentMode.REPLACEMENT);
    assertThat(parts.get(1).getCount()).isEqualTo(1);
    assertThat(parts.get(1).isOptional()).isTrue();
  }

  @Test
  @Transactional
  @DisplayName("an alternative is a different plan, not another attack")
  void medusa() {
    List<FeatureComponent> parts = multiattackOf("Medusa").getComponents();

    // "two Claw attacks and one Snake Hair attack, or it makes three Poison Ray
    // attacks" — read as additive this is a Medusa with six attacks a turn.
    assertThat(parts).hasSize(3);
    assertThat(parts).extracting(FeatureComponent::getMode)
        .containsExactly(ComponentMode.FIXED, ComponentMode.FIXED, ComponentMode.ALTERNATIVE);
    assertThat(parts.get(2).getReferencedFeature().getName()).isEqualTo("Poison Ray");
    assertThat(parts.get(2).getCount()).isEqualTo(3);
  }

  @Test
  @Transactional
  @DisplayName("components read in the book's order and point inside their own stat block")
  void componentsAreOrderedAndLocal() {
    Feature tarrasque = multiattackOf("Tarrasque");

    // "one Bite attack and three other attacks, using Claw or Tail in any
    // combination" — the Bite is printed first and parsed second.
    assertThat(tarrasque.getComponents())
        .extracting(c -> c.getReferencedFeature().getName())
        .containsExactly("Bite", "Claw", "Tail");

    long strayReferences =
        ((Number) em.createNativeQuery(
                    """
                    select count(*) from feature_components c
                    join features owner on owner.id = c.feature_id
                    join features target on target.id = c.references_feature_id
                    where owner.stat_block_id is distinct from target.stat_block_id
                       or target.id = owner.id
                    """)
                .getSingleResult())
            .longValue();
    // A component that reached into another creature's stat block, or back at
    // its own Multiattack, would loop the simulator rather than fail loudly.
    assertThat(strayReferences).isZero();
  }

  @Test
  @DisplayName("overriding a creature keeps its Multiattack pointing at its own copies")
  void overrideKeepsComponentsLocal() {
    // Read through the service, not the entity: this test is deliberately not
    // transactional, because copy-on-write is what it is about and a shared
    // session would hide whether the override really got its own rows.
    UUID baseId =
        monsters.findByOwnerIdIsNull().stream()
            .filter(m -> m.getName().equals("Aboleth"))
            .findFirst()
            .orElseThrow()
            .getId();
    MonsterResponse original = monsterService.get(baseId, null);
    UUID baseTentacleId = featureId(original, "Tentacle");
    UUID user = UUID.randomUUID();

    // What the editor sends: the base creature's feature ids, because that is
    // what it was handed. Copy-on-write then builds new features, and following
    // those ids would leave the DM's aboleth swinging the shared one's tentacle.
    FeatureRequest tentacle =
        new FeatureRequest(
            baseTentacleId, "Tentacle", null, Activation.ACTION, null, null, null, null, false,
            UsesReset.AT_WILL, null, null, null, null, null, null, null, null, null, null,
            List.of(), List.of());
    FeatureRequest multiattack =
        new FeatureRequest(
            null, "Multiattack", "The aboleth makes two Tentacle attacks.", Activation.ACTION,
            null, null, null, null, false, UsesReset.AT_WILL, null, null, null, null, null, null,
            null, null, null, null,
            List.of(),
            List.of(new FeatureComponentRequest(null, baseTentacleId, 2, false,
                ComponentMode.FIXED, null)));

    MonsterResponse override =
        monsterService.update(
            baseId,
            new MonsterRequest(original.name(), null,
                new StatBlockRequest(
                    CreatureSize.LARGE, CreatureType.ABERRATION, null, null,
                    17, null, 7, 150, 20, 10, 40, Map.of(MovementType.SWIM, 40), false,
                    21, 9, 15, 18, 15, 18, Map.of(), Map.of(), Map.of(), 20,
                    List.of(), Set.of(), "Deep Speech", 120,
                    new BigDecimal("10"), 5900, 4, null, null, null, 3,
                    List.of(tentacle, multiattack))),
            user);
    try {
      FeatureResponse saved =
          override.statBlock().features().stream()
              .filter(f -> f.name().equals("Multiattack"))
              .findFirst()
              .orElseThrow();
      UUID ownTentacleId = featureId(override, "Tentacle");

      assertThat(ownTentacleId).isNotEqualTo(baseTentacleId);
      assertThat(saved.components()).hasSize(1);
      assertThat(saved.components().getFirst().referencedFeatureId()).isEqualTo(ownTentacleId);
      assertThat(saved.components().getFirst().count()).isEqualTo(2);

      // And the shared creature is untouched by any of it.
      MonsterResponse stillBase = monsterService.get(baseId, null);
      assertThat(stillBase.statBlock().features())
          .filteredOn(f -> f.name().equals("Multiattack"))
          .allSatisfy(f -> assertThat(f.components()).hasSize(3));
    } finally {
      monsterService.revert(baseId, user);
    }
  }

  @Test
  @DisplayName("a Multiattack can be authored: the wire carries mode and choice group")
  void componentsRoundTripThroughTheRequest() {
    UUID user = UUID.randomUUID();
    UUID baseId =
        monsters.findByOwnerIdIsNull().stream()
            .filter(m -> m.getName().equals("Assassin"))
            .findFirst()
            .orElseThrow()
            .getId();
    MonsterResponse original = monsterService.get(baseId, null);
    UUID shortsword = featureId(original, "Shortsword");

    // What an editor will send once it has controls: two lines of one
    // Multiattack, sharing a choice group, three attacks between them. This
    // asserts the request can say it before any UI is built on top.
    FeatureRequest sword =
        new FeatureRequest(
            featureId(original, "Shortsword"), "Shortsword", null, Activation.ACTION, null,
            null, null, null, false, UsesReset.AT_WILL, null, null, null, null, null, null,
            null, null, null, null, List.of(), List.of());
    FeatureRequest crossbow =
        new FeatureRequest(
            featureId(original, "Light Crossbow"), "Light Crossbow", null, Activation.ACTION,
            null, null, null, null, false, UsesReset.AT_WILL, null, null, null, null, null,
            null, null, null, null, null, List.of(), List.of());
    FeatureRequest multiattack =
        new FeatureRequest(
            null, "Multiattack", "The assassin makes three attacks.", Activation.ACTION, null,
            null, null, null, false, UsesReset.AT_WILL, null, null, null, null, null, null,
            null, null, null, null,
            List.of(),
            List.of(
                new FeatureComponentRequest(null, shortsword, 3, false, ComponentMode.CHOICE, 0),
                new FeatureComponentRequest(
                    null, featureId(original, "Light Crossbow"), 3, false,
                    ComponentMode.CHOICE, 0)));

    MonsterResponse saved =
        monsterService.update(
            baseId,
            new MonsterRequest(original.name(), null,
                new StatBlockRequest(
                    CreatureSize.MEDIUM, CreatureType.HUMANOID, null, null,
                    16, null, 4, 78, 12, 8, 30, Map.of(MovementType.WALK, 30), false,
                    11, 16, 14, 13, 11, 10, Map.of(), Map.of(), Map.of(), 13,
                    List.of(), Set.of(), "Common, Thieves' cant", null,
                    new BigDecimal("8"), 3900, 3, null, null, null, null,
                    List.of(sword, crossbow, multiattack))),
            user);
    try {
      var components =
          saved.statBlock().features().stream()
              .filter(f -> f.name().equals("Multiattack"))
              .findFirst()
              .orElseThrow()
              .components();

      assertThat(components).hasSize(2);
      assertThat(components).allSatisfy(
          c -> {
            assertThat(c.mode()).isEqualTo(ComponentMode.CHOICE);
            assertThat(c.count()).isEqualTo(3);
            assertThat(c.choiceGroup()).isZero();
          });
      assertThat(components)
          .extracting(FeatureComponentResponse::referencedFeatureName)
          .containsExactlyInAnyOrder("Shortsword", "Light Crossbow");
      // Resolved against this save's own features, not the shared Assassin's.
      assertThat(components)
          .extracting(FeatureComponentResponse::referencedFeatureId)
          .doesNotContain(shortsword);
    } finally {
      monsterService.revert(baseId, user);
    }
  }
}
