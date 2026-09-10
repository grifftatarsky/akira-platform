package com.gpt.oozengine;

import static com.gpt.oozengine.util.Geometry.feet;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.gpt.oozengine.constant.rules.Capability;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.Disposition;
import com.gpt.oozengine.model.creature.StatBlock;
import com.gpt.oozengine.model.encounter.BattleMap;
import com.gpt.oozengine.model.encounter.Combatant;
import com.gpt.oozengine.service.EncounterService;
import com.gpt.oozengine.util.Geometry.Point;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Building a board out of the creatures we actually imported.
 *
 * <p>Uses real seeded stat blocks rather than fixtures, because the claims being
 * tested are about them: that a swarm's licence to share a square comes from its
 * own trait, and that a tarrasque's footprint is what makes it hard to stand
 * next to.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@Transactional
class EncounterTests {

  @Autowired private EncounterService encounters;
  @Autowired private EntityManager em;

  private final UUID dm = UUID.randomUUID();

  private StatBlock statBlockOf(String monster) {
    return em.createQuery("""
        select m.statBlock from Monster m where m.ownerId is null and m.name = :n
        """, StatBlock.class).setParameter("n", monster).getSingleResult();
  }

  private Combatant token(String monster, int xFeet, int yFeet) {
    Combatant c = new Combatant();
    c.setStatBlock(statBlockOf(monster));
    c.setName(monster);
    c.setX(feet(xFeet));
    c.setY(feet(yFeet));
    return c;
  }

  @Test
  @DisplayName("A DM builds a board and everything on it comes back in one read")
  void buildAndReload() {
    var e = encounters.create(dm, "Ambush at the ford", new BattleMap());
    encounters.place(e.getId(), dm, token("Owlbear", 10, 10));
    encounters.place(e.getId(), dm, token("Goblin Warrior", 30, 10));
    em.flush();
    em.clear();

    var loaded = encounters.get(e.getId(), dm);
    assertThat(loaded.getCombatants()).allSatisfy(c -> assertThat(c.getId()).isNotNull());
    assertThat(loaded.getCombatants()).hasSize(2)
        .extracting(Combatant::getName)
        .containsExactlyInAnyOrder("Owlbear", "Goblin Warrior");
    assertThat(loaded.getMap().getWidth()).isEqualTo(20);
  }

  @Test
  @DisplayName("Another DM's encounter is not found, rather than forbidden")
  void ownershipIsRowLevel() {
    var e = encounters.create(dm, "Mine", new BattleMap());

    // No authority grants you someone else's encounter, so the rule lives in
    // the service — and a stranger should not learn the id exists.
    assertThatThrownBy(() -> encounters.get(e.getId(), UUID.randomUUID()))
        .isInstanceOf(ResponseStatusException.class)
        .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName("Two creatures cannot be placed in one space")
  void overlapIsRefused() {
    var e = encounters.create(dm, "Crowded", new BattleMap());
    encounters.place(e.getId(), dm, token("Owlbear", 10, 10));

    assertThatThrownBy(() -> encounters.place(e.getId(), dm, token("Goblin Warrior", 10, 10)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("occupied");
  }

  @Test
  @DisplayName("A swarm may share a square, on the strength of its own trait")
  void swarmSharesASquare() {
    // Swarm: "can occupy another creature's space and vice versa". The rule is
    // read off the creature's imported capabilities, not special-cased by name.
    var swarm = statBlockOf("Swarm of Rats");
    assertThat(EncounterService.capabilitiesOf(withStatBlock(swarm)))
        .contains(Capability.OCCUPY_CREATURE_SPACE);

    var e = encounters.create(dm, "Rats", new BattleMap());
    encounters.place(e.getId(), dm, token("Goblin Warrior", 10, 10));
    encounters.place(e.getId(), dm, token("Swarm of Rats", 10, 10));

    assertThat(encounters.get(e.getId(), dm).getCombatants()).hasSize(2);
  }

  @Test
  @DisplayName("A refused move leaves the board exactly as it was")
  void refusedMoveDoesNotHalfApply() {
    var e = encounters.create(dm, "Standoff", new BattleMap());
    var owlbear = encounters.place(e.getId(), dm, token("Owlbear", 10, 10));
    encounters.place(e.getId(), dm, token("Goblin Warrior", 30, 10));

    assertThatThrownBy(() ->
        encounters.moveTo(e.getId(), dm, owlbear.getId(), new Point(feet(30), feet(10), 0)))
        .isInstanceOf(ResponseStatusException.class);

    assertThat(owlbear.getX()).isEqualTo(feet(10));
    assertThat(owlbear.getY()).isEqualTo(feet(10));
  }

  @Test
  @DisplayName("A tarrasque takes up more room than a goblin, from its stat block")
  void footprintComesFromTheCreature() {
    var tarrasque = token("Tarrasque", 0, 0);
    var goblin = token("Goblin Warrior", 0, 0);

    assertThat(tarrasque.getStatBlock().getSize()).isEqualTo(CreatureSize.GARGANTUAN);
    assertThat(EncounterService.footprintOf(tarrasque).spaceHalfFeet()).isEqualTo(feet(20));
    assertThat(EncounterService.footprintOf(goblin).spaceHalfFeet()).isEqualTo(feet(5));

    // Placed 15 feet apart, centre to centre, their edges are already touching:
    // 10 of those feet are inside the tarrasque and 2 1/2 inside the goblin.
    goblin.setX(feet(15));
    assertThat(EncounterService.separationFeet(tarrasque, goblin)).isEqualTo(2.5);
  }

  @Test
  @DisplayName("The roster is capped, and says so")
  void rosterIsCapped() {
    var e = encounters.create(dm, "Horde", new BattleMap());
    for (int i = 0; i < EncounterService.MAX_COMBATANTS; i++) {
      encounters.place(e.getId(), dm, token("Goblin Warrior", 5 * i % 95, 5 * (i / 19)));
    }

    assertThatThrownBy(() -> encounters.place(e.getId(), dm, token("Goblin Warrior", 90, 90)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("at most");
  }

  @Test
  @DisplayName("On-deck combatants are placed like any other, and marked")
  void onDeckIsJustADisposition() {
    var e = encounters.create(dm, "Balcony", new BattleMap());
    var lurker = token("Goblin Warrior", 50, 50);
    lurker.setDisposition(Disposition.ON_DECK);
    lurker.setSurprised(true);
    encounters.place(e.getId(), dm, lurker);
    em.flush();
    em.clear();

    var loaded = encounters.get(e.getId(), dm).getCombatants().getFirst();
    assertThat(loaded.getDisposition()).isEqualTo(Disposition.ON_DECK);
    assertThat(loaded.isSurprised()).isTrue();
  }

  private static Combatant withStatBlock(StatBlock sb) {
    Combatant c = new Combatant();
    c.setStatBlock(sb);
    return c;
  }
}
