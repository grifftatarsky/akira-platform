package com.gpt.oozengine.util;

import com.gpt.oozengine.model.mechanics.DiceRoll;

/**
 * What a fall costs, from the SRD's Falling entry.
 *
 * <p>The whole rule, verbatim: "A creature that falls takes 1d6 Bludgeoning
 * damage at the end of the fall for every 10 feet it fell, to a maximum of 20d6.
 * When the creature lands, it has the Prone condition unless it avoids taking
 * any damage from the fall." And for a landing in liquid: "can use its Reaction
 * to make a DC 15 Strength (Athletics) or Dexterity (Acrobatics) check… On a
 * successful check, any damage resulting from the fall is halved."
 *
 * <p>Its own class because falling is the one place the board's elevation turns
 * into damage, and because every clause of it has an edge the engine must not
 * get wrong: the dice round <em>down</em> per ten feet, they cap, and the Prone
 * is conditional on damage rather than on distance.
 *
 * <p><b>Deliberately free of terrain.</b> This is a rules table — feet in,
 * dice out — and the tracker applies it when a creature falls, so it must not
 * drag a board in with it. Whether the ground here is water is the board's
 * question and lives on {@code Battlefield}.
 */
public final class Falling {

  /** "to a maximum of 20d6". */
  public static final int MAX_DICE = 20;

  /** The DC to hit the water well, and halve what it costs. */
  public static final int LIQUID_CHECK_DC = 15;

  private Falling() {}

  /**
   * The damage for a fall of this many feet, or null for a fall that hurts
   * nobody.
   *
   * <p>"for every 10 feet it fell" — so nine feet is no dice at all, and
   * nineteen is one. Rounding up here would make every trip off a low wall a
   * d6, which is not what the book says and is exactly the kind of quiet
   * generosity that makes a simulator disagree with a table.
   */
  public static DiceRoll damage(int feetFallen) {
    int dice = Math.min(MAX_DICE, Math.max(0, feetFallen) / 10);
    if (dice == 0) {
      return null;
    }
    // The average of Nd6 is 3.5N; the book prints the rounded-down value.
    return new DiceRoll(dice, 6, null, dice * 7 / 2);
  }

  /** The distance at which more height stops mattering. */
  public static int terminalFeet() {
    return MAX_DICE * 10;
  }

  /**
   * Whether the creature lands Prone.
   *
   * <p>Keyed to damage, not to distance: "unless it avoids taking any damage
   * from the fall". A creature that fell 200 feet and shrugged off every die is
   * still on its feet.
   */
  public static boolean landsProne(int damageTaken) {
    return damageTaken > 0;
  }

  /**
   * The damage after a successful DC 15 check into liquid: "any damage resulting
   * from the fall is halved".
   */
  public static int halved(int damageTaken) {
    return damageTaken / 2;
  }

  /**
   * How far a creature falls moving from one elevation to another, in feet.
   *
   * <p>Zero when the ground rises or stays level — walking up a slope is not a
   * negative fall.
   */
  public static int dropBetween(int fromElevationFeet, int toElevationFeet) {
    return Math.max(0, fromElevationFeet - toElevationFeet);
  }
}
