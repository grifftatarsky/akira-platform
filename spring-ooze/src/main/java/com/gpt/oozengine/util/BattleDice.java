package com.gpt.oozengine.util;

import com.gpt.oozengine.constant.DiceModifiers;
import com.gpt.oozengine.constant.rules.RollSource;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.SplittableRandom;

/**
 * Dice a battle can replay.
 *
 * <p>{@link DiceUtil} rolls from {@code ThreadLocalRandom}, which is right for a
 * dice roller and useless for a log: the same battle replayed would take a
 * different course, and undo would be a different fight rather than the same one
 * a step earlier.
 *
 * <p><b>Each roll is derived from the seed and its own index</b>, rather than
 * from a running generator. That means roll 40 can be recomputed without
 * replaying rolls 1 to 39 — which is exactly what rewinding into the middle of a
 * log needs, and what a sequential {@code Random} cannot do.
 */
public final class BattleDice {

  private final long seed;

  public BattleDice(long seed) {
    this.seed = seed;
  }

  /**
   * One roll, and everything needed to check it.
   *
   * @param dice every die face rolled, including the one Advantage discarded —
   *     a log that keeps only the total cannot show a DM why the number was what
   *     it was
   * @param kept the face actually used
   */
  public record Roll(
      int faces,
      List<Integer> dice,
      int kept,
      int bonus,
      int total,
      DiceModifiers modifier,
      RollSource source) {}

  /**
   * A d20 test at this index, with Advantage or Disadvantage applied.
   *
   * <p>Advantage and Disadvantage cancel outright rather than accumulating,
   * which is the 2024 rule and the reason this takes a set rather than a count.
   */
  public Roll d20(long index, int bonus, EnumSet<DiceModifiers> modifiers) {
    boolean up = modifiers.contains(DiceModifiers.ADVANTAGE);
    boolean down = modifiers.contains(DiceModifiers.DISADVANTAGE);
    if (up && down) {
      up = false;
      down = false;
    }
    SplittableRandom rng = rngFor(index);
    List<Integer> rolled = new ArrayList<>(2);
    rolled.add(rng.nextInt(1, 21));
    if (up || down) {
      rolled.add(rng.nextInt(1, 21));
    }
    int kept = up ? Math.max(rolled.get(0), rolled.get(1))
        : down ? Math.min(rolled.get(0), rolled.get(1))
        : rolled.get(0);
    DiceModifiers modifier = up ? DiceModifiers.ADVANTAGE : down ? DiceModifiers.DISADVANTAGE : null;
    return new Roll(20, List.copyOf(rolled), kept, bonus, kept + bonus, modifier,
        RollSource.RANDOM);
  }

  /** {@code count}d{@code faces} plus a bonus, at this index. */
  public Roll pool(long index, int count, int faces, int bonus) {
    SplittableRandom rng = rngFor(index);
    List<Integer> rolled = new ArrayList<>(count);
    int sum = 0;
    for (int i = 0; i < count; i++) {
      int die = rng.nextInt(1, faces + 1);
      rolled.add(die);
      sum += die;
    }
    return new Roll(faces, List.copyOf(rolled), sum, bonus, sum + bonus, null, RollSource.RANDOM);
  }

  /** A number the DM supplied, recorded so the log says where it came from. */
  public static Roll manual(int faces, int result, int bonus) {
    return new Roll(faces, List.of(result), result, bonus, result + bonus, null, RollSource.MANUAL);
  }

  /** The book's printed average, taken instead of rolling. */
  public static Roll average(int faces, int average, int bonus) {
    return new Roll(faces, List.of(), average, bonus, average + bonus, null, RollSource.AVERAGE);
  }

  /**
   * A generator for one roll index.
   *
   * <p>The seed and index are mixed rather than concatenated: adjacent indices
   * off a weakly mixed seed produce visibly correlated first values, and
   * initiative rolls all happen at adjacent indices.
   */
  private SplittableRandom rngFor(long index) {
    long z = seed + index * 0x9E3779B97F4A7C15L;
    z = (z ^ (z >>> 30)) * 0xBF58476D1CE4E5B9L;
    z = (z ^ (z >>> 27)) * 0x94D049BB133111EBL;
    return new SplittableRandom(z ^ (z >>> 31));
  }
}
