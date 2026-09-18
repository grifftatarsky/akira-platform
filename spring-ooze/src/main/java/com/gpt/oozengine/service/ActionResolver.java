package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.DiceModifiers;
import com.gpt.oozengine.constant.rules.Delivery;
import com.gpt.oozengine.constant.rules.EffectOutcome;
import com.gpt.oozengine.constant.rules.StepTrigger;
import com.gpt.oozengine.model.battle.Participant;
import com.gpt.oozengine.model.mechanics.DiceRoll;
import com.gpt.oozengine.model.mechanics.Effect;
import com.gpt.oozengine.model.mechanics.Feature;
import com.gpt.oozengine.model.mechanics.FeatureStep;
import com.gpt.oozengine.model.mechanics.Rider;
import com.gpt.oozengine.util.BattleDice;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Executing a feature: rolls, outcomes, and what lands on whom.
 *
 * <p>Pure. It takes an actor, a feature, targets and what the board says about
 * them, and returns a list of things that happened — it applies nothing and
 * writes no log. That is what makes every clause of the SRD in here testable
 * without a database, and it is why the same code can be replayed during a
 * rewind without re-appending anything.
 *
 * <p><b>It never looks anything up.</b> Range and cover arrive as
 * {@link TargetContext}, the creature's Armor Class and resistances are on the
 * participant, and the feature is handed in. So resolution can live beside the
 * log without the tracker learning what a map is.
 */
public final class ActionResolver {

  private ActionResolver() {}

  /** One thing that happened, ready to be logged and applied. */
  public sealed interface Outcome {

    /** Which participant it happened to. */
    java.util.UUID targetId();

    /** A line a DM can read. */
    String summary();

    /** The numbers, for the event payload. */
    Map<String, Object> payload();
  }

  public record AttackRoll(java.util.UUID targetId, int total, int armorClass, boolean hit,
      boolean critical, BattleDice.Roll roll, String summary,
      Map<String, Object> payload) implements Outcome {}

  public record SavingThrow(java.util.UUID targetId, int total, int dc, boolean success,
      BattleDice.Roll roll, String summary, Map<String, Object> payload) implements Outcome {}

  public record Damage(java.util.UUID targetId, int amount, int afterResponse, String damageType,
      String summary, Map<String, Object> payload) implements Outcome {}

  public record Healing(java.util.UUID targetId, int amount, String summary,
      Map<String, Object> payload) implements Outcome {}

  public record TemporaryHitPoints(java.util.UUID targetId, int amount, String summary,
      Map<String, Object> payload) implements Outcome {}

  public record ConditionApplied(java.util.UUID targetId, String condition, Integer durationAmount,
      String durationUnit, String summary, Map<String, Object> payload) implements Outcome {}

  public record RiderApplied(java.util.UUID targetId, String target, String mode, Integer amount,
      String gate, String summary, Map<String, Object> payload) implements Outcome {}

  public record Moved(java.util.UUID targetId, Integer feet, String how, String summary,
      Map<String, Object> payload) implements Outcome {}

  /** Something the DM should weigh that moved no numbers. */
  public record Information(java.util.UUID targetId, String text, String summary,
      Map<String, Object> payload) implements Outcome {}

  /** A clause the engine read but could not execute; the DM rules on it. */
  public record NeedsAdjudication(java.util.UUID targetId, String text, String summary,
      Map<String, Object> payload) implements Outcome {}

  /** The result of resolving one feature against its targets. */
  public record Resolution(List<Outcome> outcomes, long rollsUsed) {}

  /**
   * Resolves {@code feature} by {@code actor} against {@code targets}.
   *
   * @param firstRollIndex where in the battle's roll sequence to start, so the
   *     whole resolution is reproducible from the seed
   */
  public static Resolution resolve(Participant actor, Feature feature, List<Participant> targets,
      Map<java.util.UUID, TargetContext> contexts, BattleDice dice, long firstRollIndex) {
    List<Outcome> out = new ArrayList<>();
    long roll = firstRollIndex;

    if (feature.getSteps().isEmpty()) {
      out.add(adjudicate(null, feature));
      return new Resolution(out, 0);
    }

    for (Participant target : targets) {
      // An unsaved participant has no id to key on, and Map.of rejects a null
      // key outright rather than missing — so the open context is chosen here
      // instead of being looked up and thrown from.
      TargetContext ctx = target.getId() == null
          ? TargetContext.open(null)
          : contexts.getOrDefault(target.getId(), TargetContext.open(target.getId()));
      if (!ctx.targetable()) {
        // "Total Cover: can't be targeted directly" — a refusal rather than a
        // penalty, so it is said in the log instead of quietly missing.
        out.add(new NeedsAdjudication(target.getId(),
            "Cannot be targeted: " + reasonNotTargetable(ctx),
            "%s cannot target %s".formatted(actor.getName(), target.getName()),
            Map.of("reason", reasonNotTargetable(ctx))));
        continue;
      }
      int before = out.size();
      StepResult previous = null;
      for (FeatureStep step : feature.getSteps()) {
        if (!triggered(step.getTrigger(), previous)) {
          continue;
        }
        StepResult result = resolveStep(actor, feature, step, target, ctx, dice, roll, out);
        roll += result.rollsUsed();
        previous = result;
      }
      // A feature can have steps and still say nothing executable — the Oni's
      // Shape-Shift parses to one automatic step with no effects, because the
      // book wrote a rule rather than a procedure. Producing silence for it is
      // the exact failure this design exists to prevent, so an empty resolution
      // goes to the DM with the book's text.
      if (out.size() == before) {
        out.add(adjudicate(target.getId(), feature));
      }
    }
    return new Resolution(out, roll - firstRollIndex);
  }

  private record StepResult(Boolean hit, Boolean saved, boolean critical, long rollsUsed) {}

  private static StepResult resolveStep(Participant actor, Feature feature, FeatureStep step,
      Participant target, TargetContext ctx, BattleDice dice, long rollIndex, List<Outcome> out) {
    Delivery delivery = step.getDelivery() == null ? Delivery.AUTOMATIC : step.getDelivery();
    return switch (delivery) {
      case ATTACK_ROLL -> {
        int bonus = step.getAttackBonus() == null ? 0 : step.getAttackBonus();
        var roll = dice.d20(rollIndex, bonus, EnumSet.noneOf(DiceModifiers.class));
        // Cover raises the number to beat rather than lowering the roll, which
        // is how the book words it and keeps the die honest in the log.
        int armorClass = target.getArmorClass() + ctx.coverArmorClassBonus();
        // A natural 20 hits whatever the Armor Class is, and a natural 1 misses
        // whatever the bonus is — neither is a comparison.
        boolean natural20 = roll.kept() == 20;
        boolean natural1 = roll.kept() == 1;
        boolean hit = natural20 || (!natural1 && roll.total() >= armorClass);
        out.add(new AttackRoll(target.getId(), roll.total(), armorClass, hit, natural20, roll,
            "%s attacks %s: %d vs AC %d — %s".formatted(actor.getName(), target.getName(),
                roll.total(), armorClass, hit ? (natural20 ? "critical hit" : "hit") : "miss"),
            rollPayload(roll, Map.of("armorClass", armorClass, "hit", hit,
                "critical", natural20, "coverBonus", ctx.coverArmorClassBonus()))));
        if (hit) {
          applyEffects(step, target, hitOutcomes(natural20), natural20, out);
        } else {
          applyEffects(step, target, EnumSet.of(EffectOutcome.MISS, EffectOutcome.HIT_OR_MISS),
              false, out);
        }
        yield new StepResult(hit, null, natural20, 1);
      }
      case SAVING_THROW -> {
        int dc = step.getSaveDc() == null ? 10 : step.getSaveDc();
        // The save's own bonus is the target's; a tracker without a stat block
        // has none, and the DM adjusts the roll if they disagree.
        var roll = dice.d20(rollIndex, 0, EnumSet.noneOf(DiceModifiers.class));
        boolean success = roll.total() >= dc;
        out.add(new SavingThrow(target.getId(), roll.total(), dc, success, roll,
            "%s saves vs DC %d: %d — %s".formatted(target.getName(), dc, roll.total(),
                success ? "success" : "failure"),
            rollPayload(roll, Map.of("dc", dc, "success", success,
                "ability", step.getSaveAbility() == null ? "" : step.getSaveAbility().name()))));
        applyEffects(step, target,
            success ? EnumSet.of(EffectOutcome.SAVE_SUCCESS, EffectOutcome.SAVE_EITHER)
                : EnumSet.of(EffectOutcome.SAVE_FAILURE, EffectOutcome.SAVE_EITHER),
            false, out);
        yield new StepResult(null, success, false, 1);
      }
      default -> {
        applyEffects(step, target, EnumSet.of(EffectOutcome.ALWAYS), false, out);
        yield new StepResult(null, null, false, 0);
      }
    };
  }

  /** A critical also fires anything keyed to CRITICAL_HIT, not only to HIT. */
  private static EnumSet<EffectOutcome> hitOutcomes(boolean critical) {
    EnumSet<EffectOutcome> set =
        EnumSet.of(EffectOutcome.ALWAYS, EffectOutcome.HIT, EffectOutcome.HIT_OR_MISS);
    if (critical) {
      set.add(EffectOutcome.CRITICAL_HIT);
    }
    return set;
  }

  private static void applyEffects(FeatureStep step, Participant target,
      EnumSet<EffectOutcome> firing, boolean critical, List<Outcome> out) {
    for (Effect e : step.getEffects()) {
      EffectOutcome outcome = e.getOutcome() == null ? EffectOutcome.ALWAYS : e.getOutcome();
      if (outcome != EffectOutcome.ALWAYS && !firing.contains(outcome)) {
        continue;
      }
      if (e.getKind() == null) {
        continue;
      }
      switch (e.getKind()) {
        case DAMAGE -> damage(e, target, critical, out);
        case HEALING -> {
          int amount = average(e.getAmount());
          out.add(new Healing(target.getId(), amount,
              "%s regains %d Hit Points".formatted(target.getName(), amount),
              Map.of("amount", amount)));
        }
        case TEMPORARY_HIT_POINTS -> {
          int amount = average(e.getAmount());
          out.add(new TemporaryHitPoints(target.getId(), amount,
              "%s gains %d Temporary Hit Points".formatted(target.getName(), amount),
              Map.of("amount", amount)));
        }
        case APPLY_CONDITION -> {
          String name = e.getCondition() == null ? "" : e.getCondition().getName();
          out.add(new ConditionApplied(target.getId(), name, e.getDurationAmount(),
              e.getDurationUnit() == null ? null : e.getDurationUnit().name(),
              "%s has the %s condition".formatted(target.getName(), name),
              payload("condition", name, "durationAmount", e.getDurationAmount(),
                  "durationUnit", e.getDurationUnit())));
        }
        case APPLY_RIDER -> {
          for (Rider r : e.getRiders()) {
            out.add(new RiderApplied(target.getId(), r.getTarget().name(), r.getMode().name(),
                r.getAmount(), r.getGate(),
                "%s: %s on %s".formatted(target.getName(), r.getMode(), r.getTarget()),
                payload("target", r.getTarget(), "mode", r.getMode(), "amount", r.getAmount(),
                    "gate", r.getGate())));
          }
        }
        case MOVEMENT -> out.add(new Moved(target.getId(), e.getMovementFeet(), e.getNotes(),
            "%s is moved%s".formatted(target.getName(),
                e.getMovementFeet() == null ? "" : " " + e.getMovementFeet() + " feet"),
            payload("feet", e.getMovementFeet(), "how", e.getNotes())));
        case INFORMATION -> out.add(new Information(target.getId(), e.getNotes(),
            e.getNotes() == null ? "Something to consider" : e.getNotes(),
            payload("text", e.getNotes())));
        // SUMMON, AREA_TERRAIN, ABILITY_SCORE_CHANGE, RESOURCE_CHANGE and
        // SPECIAL all change something outside this creature. They are read and
        // handed to the DM rather than guessed at.
        default -> out.add(new NeedsAdjudication(target.getId(),
            e.getKind() + (e.getNotes() == null ? "" : ": " + e.getNotes()),
            "%s: %s needs a ruling".formatted(target.getName(), e.getKind()),
            payload("kind", e.getKind(), "notes", e.getNotes())));
      }
    }
  }

  private static void damage(Effect e, Participant target, boolean critical, List<Outcome> out) {
    int rolled = average(e.getAmount());
    if (critical && e.getAmount() != null && e.getAmount().getCount() != null) {
      // A critical doubles the dice, not the modifier — so the flat bonus is
      // added once and only the dice half is repeated.
      int diceOnly = e.getAmount().getCount() * (e.getAmount().getFaces() + 1) / 2;
      rolled += diceOnly;
    }
    if (e.isHalfDamage()) {
      // The SAVE_SUCCESS marker the parser writes for "Success: Half damage",
      // which carries no dice of its own — it halves whatever the failure did.
      return;
    }
    String type = e.getDamageType() == null ? null : e.getDamageType().name();
    int after = target.afterDamageResponse(rolled, e.getDamageType());
    out.add(new Damage(target.getId(), rolled, after, type,
        "%s takes %d%s damage%s".formatted(target.getName(), after,
            type == null ? "" : " " + type.toLowerCase(),
            after == rolled ? "" : " (from %d)".formatted(rolled)),
        payload("rolled", rolled, "applied", after, "damageType", type,
            "critical", critical)));
  }

  /**
   * Whether a chained step fires, given what the one before it did.
   *
   * <p>Fourteen creatures in the bestiary attack and then force a save on a hit;
   * running the second step unconditionally would have a werewolf infect
   * everything it swings at.
   */
  private static boolean triggered(StepTrigger trigger, StepResult previous) {
    if (trigger == null || trigger == StepTrigger.ALWAYS) {
      return true;
    }
    if (previous == null) {
      return false;
    }
    return switch (trigger) {
      case ON_PREVIOUS_HIT -> Boolean.TRUE.equals(previous.hit());
      case ON_PREVIOUS_MISS -> Boolean.FALSE.equals(previous.hit());
      case ON_PREVIOUS_SUCCESS -> Boolean.TRUE.equals(previous.saved());
      case ON_PREVIOUS_FAILURE -> Boolean.FALSE.equals(previous.saved());
      default -> true;
    };
  }

  private static NeedsAdjudication adjudicate(java.util.UUID targetId, Feature feature) {
    // The Oni's Shape-Shift has nothing to roll: the book wrote a rule, not a
    // procedure. It still costs the action and still lands in the log.
    return new NeedsAdjudication(targetId, feature.getDescription(),
        "%s — you resolve this".formatted(feature.getName()),
        payload("feature", feature.getName(), "text", feature.getDescription()));
  }

  private static String reasonNotTargetable(TargetContext ctx) {
    if (ctx.totalCover()) {
      return "Total Cover";
    }
    return ctx.inRange() ? "no line of sight" : "out of range";
  }

  /** The book's printed average, which is what an unrolled amount is worth. */
  private static int average(DiceRoll d) {
    if (d == null) {
      return 0;
    }
    if (d.getAverage() != null) {
      return d.getAverage();
    }
    if (d.getCount() == null || d.getFaces() == null) {
      return d.getBonus() == null ? 0 : d.getBonus();
    }
    return d.getCount() * (d.getFaces() + 1) / 2 + (d.getBonus() == null ? 0 : d.getBonus());
  }

  private static Map<String, Object> rollPayload(BattleDice.Roll roll, Map<String, Object> extra) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("dice", roll.dice());
    out.put("kept", roll.kept());
    out.put("bonus", roll.bonus());
    out.put("total", roll.total());
    out.put("source", roll.source().name());
    out.putAll(extra);
    return out;
  }

  /**
   * A payload that tolerates nulls, which {@code Map.of} does not.
   *
   * <p>Numbers and booleans keep their types; only enums and nulls are made into
   * strings. Stringifying everything is tempting and wrong — the fold reads
   * numbers straight back out of these payloads, and a "7" it cannot cast is a
   * rewind that silently loses a hit point total.
   */
  private static Map<String, Object> payload(Object... pairs) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (int i = 0; i + 1 < pairs.length; i += 2) {
      Object v = pairs[i + 1];
      out.put(String.valueOf(pairs[i]),
          v == null ? "" : v instanceof Number || v instanceof Boolean ? v : v.toString());
    }
    return out;
  }
}
