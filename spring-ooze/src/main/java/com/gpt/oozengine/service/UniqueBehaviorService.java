package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.UniqueBehavior;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * The named handlers for creatures whose rules no general mechanism reaches.
 *
 * <p>Two of 330 qualify, and keeping the escape hatch that small is the point:
 * a hydra's heads set its Multiattack count, grant it Reactions and kill it, and
 * generalising for a population of one buys nothing. What it must not become is
 * a place to put anything awkward — a rider, an effect or a component is always
 * the better home when one fits.
 *
 * <p><b>Resolution runs before an action is offered, not after one is taken.</b>
 * The hydra's Multiattack has no fixed count, so the menu the DM sees is wrong
 * unless the head count is read first. {@link #resolve} is therefore called at
 * the top of a turn, and its output shapes the options rather than correcting
 * them afterwards.
 *
 * <p>State lives in the participant's own JSON copy, taken from the stat block
 * at the start of a battle and mutated there, so the catalog keeps the book's
 * opening position and two hydras in one fight lose heads independently.
 */
@Service
public class UniqueBehaviorService {

  /**
   * What a unique behaviour wants done before its owner acts.
   *
   * @param attackCountOverride how many attacks a countless Multiattack makes
   *     this turn, or null if it does not set one
   * @param extraReactions Reactions beyond the usual one, and what they are
   *     limited to
   * @param automatic true when the creature acts without anyone choosing — the
   *     shrieker's trigger is another creature's movement, so the simulator
   *     resolves it rather than offering it
   * @param notes what to show the DM about why the numbers are what they are
   */
  public record Resolution(
      Integer attackCountOverride,
      int extraReactions,
      String reactionLimit,
      boolean automatic,
      String notes) {

    static Resolution none() {
      return new Resolution(null, 0, null, false, null);
    }
  }

  /**
   * Reads the creature's state and says how this turn differs from the default.
   *
   * @param behavior which handler to run; null means nothing to do
   * @param state the participant's live copy of {@code unique_data}
   */
  public Resolution resolve(UniqueBehavior behavior, Map<String, Object> state) {
    if (behavior == null) {
      return Resolution.none();
    }
    return switch (behavior) {
      case HYDRA_HEADS -> hydra(state);
      case SHRIEKER_SHRIEK -> shrieker(state);
    };
  }

  private Resolution hydra(Map<String, Object> state) {
    int heads = intOf(state, "heads", 5);
    // "The hydra makes as many Bite attacks as it has heads", and "for each head
    // beyond one, it gets an extra Reaction that can be used only for
    // Opportunity Attacks".
    return new Resolution(
        heads,
        Math.max(0, heads - 1),
        "Opportunity Attacks only",
        false,
        heads + (heads == 1 ? " head" : " heads"));
  }

  private Resolution shrieker(Map<String, Object> state) {
    int radius = intOf(state, "triggerRadiusFeet", 30);
    return new Resolution(
        null,
        0,
        null,
        true,
        "Shrieks on its own when a creature or a source of Bright Light moves within "
            + radius + " feet. Nobody chooses this.");
  }

  /**
   * End-of-turn upkeep for a behaviour that has any.
   *
   * <p>Returns the new state rather than mutating the argument, so a caller
   * replaying the log to rebuild a battle gets the same answer every time.
   */
  public Map<String, Object> endOfTurn(UniqueBehavior behavior, Map<String, Object> state) {
    if (behavior != UniqueBehavior.HYDRA_HEADS) {
      return state;
    }
    Map<String, Object> next = new LinkedHashMap<>(state);
    int heads = intOf(state, "heads", 5);
    int lost = intOf(state, "headsLostSinceLastTurn", 0);
    boolean burned = Boolean.TRUE.equals(state.get("tookFireDamage"));

    // "At the end of each of its turns when it has at least one living head, the
    // hydra grows two heads for each of its heads that died since its last turn,
    // unless it has taken Fire damage since its last turn."
    if (heads > 0 && lost > 0 && !burned) {
      heads += lost * intOf(state, "regrowPerHead", 2);
      next.put("regainedHitPoints", intOf(state, "regrowHitPoints", 20));
    } else {
      next.put("regainedHitPoints", 0);
    }
    next.put("heads", heads);
    next.put("headsLostSinceLastTurn", 0);
    next.put("damageThisTurn", 0);
    next.put("tookFireDamage", false);
    return next;
  }

  /**
   * Applies damage taken this turn, which is what kills heads.
   *
   * <p>"Whenever the hydra takes 25 damage or more on a single turn, one of its
   * heads dies." Once per turn, not once per 25 — the threshold is a gate, not a
   * divisor, so a single 60-damage turn costs one head.
   */
  public Map<String, Object> onDamage(
      UniqueBehavior behavior, Map<String, Object> state, int amount, boolean fire) {
    if (behavior != UniqueBehavior.HYDRA_HEADS) {
      return state;
    }
    Map<String, Object> next = new LinkedHashMap<>(state);
    int before = intOf(state, "damageThisTurn", 0);
    int after = before + amount;
    next.put("damageThisTurn", after);
    if (fire) {
      next.put("tookFireDamage", true);
    }
    int threshold = intOf(state, "headLossThreshold", 25);
    if (before < threshold && after >= threshold) {
      next.put("heads", Math.max(0, intOf(state, "heads", 5) - 1));
      next.put("headsLostSinceLastTurn", intOf(state, "headsLostSinceLastTurn", 0) + 1);
    }
    return next;
  }

  private static int intOf(Map<String, Object> state, String key, int fallback) {
    Object v = state == null ? null : state.get(key);
    return v instanceof Number n ? n.intValue() : fallback;
  }
}
