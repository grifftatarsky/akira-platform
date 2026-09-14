package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.rules.UniqueBehavior;
import com.gpt.oozengine.service.UniqueBehaviorService;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The hydra, played out against its own stat block.
 *
 * <p>Its three features are one rule wearing three hats — Multiple Heads kills
 * and regrows them, Multiattack counts them, Reactive Heads counts them again —
 * so the test drives a whole fight's worth of turns rather than checking the
 * methods one at a time. Every quoted rule below is from the seeded text.
 */
class UniqueBehaviorTests {

  private final UniqueBehaviorService service = new UniqueBehaviorService();

  private Map<String, Object> hydra() {
    return new LinkedHashMap<>(Map.of(
        "heads", 5, "startingHeads", 5, "damageThisTurn", 0,
        "headsLostSinceLastTurn", 0, "tookFireDamage", false,
        "headLossThreshold", 25, "regrowPerHead", 2, "regrowHitPoints", 20));
  }

  @Test
  @DisplayName("A five-headed hydra bites five times and holds four extra Reactions")
  void countsComeOffTheHeads() {
    var r = service.resolve(UniqueBehavior.HYDRA_HEADS, hydra());

    assertThat(r.attackCountOverride()).isEqualTo(5);
    // "For each head the hydra has beyond one, it gets an extra Reaction that
    // can be used only for Opportunity Attacks."
    assertThat(r.extraReactions()).isEqualTo(4);
    assertThat(r.reactionLimit()).isEqualTo("Opportunity Attacks only");
  }

  @Test
  @DisplayName("25 damage in a turn costs one head; 60 in a turn still costs one")
  void thresholdIsAGateNotADivisor() {
    var state = service.onDamage(UniqueBehavior.HYDRA_HEADS, hydra(), 60, false);

    assertThat(state.get("heads")).isEqualTo(4);
    assertThat(state.get("headsLostSinceLastTurn")).isEqualTo(1);
    assertThat(service.resolve(UniqueBehavior.HYDRA_HEADS, state).attackCountOverride())
        .isEqualTo(4);
  }

  @Test
  @DisplayName("Damage accumulates across a turn, and crosses the threshold once")
  void damageAccumulates() {
    var state = hydra();
    state = service.onDamage(UniqueBehavior.HYDRA_HEADS, state, 10, false);
    assertThat(state.get("heads")).isEqualTo(5);

    state = service.onDamage(UniqueBehavior.HYDRA_HEADS, state, 10, false);
    assertThat(state.get("heads")).isEqualTo(5);

    // 30 total — over 25 for the first time.
    state = service.onDamage(UniqueBehavior.HYDRA_HEADS, state, 10, false);
    assertThat(state.get("heads")).isEqualTo(4);

    // Still the same turn, so no second head goes.
    state = service.onDamage(UniqueBehavior.HYDRA_HEADS, state, 40, false);
    assertThat(state.get("heads")).isEqualTo(4);
  }

  @Test
  @DisplayName("Two heads grow back for each one lost, and it regains 20 Hit Points")
  void regrowth() {
    var state = service.onDamage(UniqueBehavior.HYDRA_HEADS, hydra(), 30, false);
    state = service.endOfTurn(UniqueBehavior.HYDRA_HEADS, state);

    // Five, minus the one that died, plus two grown for it.
    assertThat(state.get("heads")).isEqualTo(6);
    assertThat(state.get("regainedHitPoints")).isEqualTo(20);
    assertThat(state.get("damageThisTurn")).isEqualTo(0);
    assertThat(state.get("headsLostSinceLastTurn")).isEqualTo(0);
  }

  @Test
  @DisplayName("Fire stops the regrowth, which is the whole reason to bring fire")
  void fireStopsRegrowth() {
    var state = service.onDamage(UniqueBehavior.HYDRA_HEADS, hydra(), 30, true);
    state = service.endOfTurn(UniqueBehavior.HYDRA_HEADS, state);

    assertThat(state.get("heads")).isEqualTo(4);
    assertThat(state.get("regainedHitPoints")).isEqualTo(0);
    // The flag clears, so next turn's regrowth is not blocked by last turn's fire.
    assertThat(state.get("tookFireDamage")).isEqualTo(false);
  }

  @Test
  @DisplayName("A headless hydra grows nothing back")
  void deadHydraStaysDead() {
    var state = hydra();
    state.put("heads", 0);
    state.put("headsLostSinceLastTurn", 1);

    assertThat(service.endOfTurn(UniqueBehavior.HYDRA_HEADS, state).get("heads")).isEqualTo(0);
  }

  @Test
  @DisplayName("A shrieker's shriek is resolved, not offered")
  void shrieksWithoutBeingAsked() {
    var r = service.resolve(UniqueBehavior.SHRIEKER_SHRIEK,
        new LinkedHashMap<>(Map.of("triggerRadiusFeet", 30)));

    // Nobody decides to shriek: the trigger is another creature's movement, so
    // the simulator has to run it rather than put it on the DM's menu.
    assertThat(r.automatic()).isTrue();
    assertThat(r.notes()).contains("30 feet");
  }

  @Test
  @DisplayName("A creature with no unique behaviour is left entirely alone")
  void nullBehaviourChangesNothing() {
    var r = service.resolve(null, Map.of());

    assertThat(r.attackCountOverride()).isNull();
    assertThat(r.extraReactions()).isZero();
    assertThat(r.automatic()).isFalse();
  }

  @Test
  @DisplayName("Every behaviour has a handler, so adding one cannot silently do nothing")
  void everyBehaviourIsHandled() {
    for (UniqueBehavior b : UniqueBehavior.values()) {
      // The switch in resolve() is exhaustive over the enum, so this fails to
      // compile rather than at runtime if a value is added without a branch —
      // but a branch that returns none() would be a silent no-op, so assert
      // each says something.
      var r = service.resolve(b, Map.of());
      assertThat(r.notes()).as("%s must explain itself", b).isNotBlank();
    }
  }
}
