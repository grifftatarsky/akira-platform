package com.gpt.oozengine.model.mechanics;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A dice expression such as {@code 2d6 + 5}, plus the average the SRD prints
 * beside it.
 *
 * <p>Both halves are stored deliberately. The simulator rolls {@link #count} d
 * {@link #faces} and adds {@link #bonus}; a DM reading the compendium, or a
 * "fixed damage" table, wants the {@link #average} the book shows. Deriving the
 * average would also disagree with the book in the handful of places where the
 * SRD rounds differently, and the book is what a DM will compare against.
 *
 * <p>A purely flat amount (Heal's 70 Hit Points) sets {@link #average} and
 * {@link #bonus} with a null {@link #count} — {@link #isFlat()} tests for it.
 */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class DiceRoll {

  @Column(name = "dice_count")
  private Integer count;

  @Column(name = "dice_faces")
  private Integer faces;

  /** Flat modifier added after the roll; null and 0 both mean "none". */
  @Column(name = "dice_bonus")
  private Integer bonus;

  /** The value the SRD prints, e.g. the 12 in "12 (2d6 + 5)". */
  @Column(name = "dice_average")
  private Integer average;

  public boolean isFlat() {
    return count == null || faces == null;
  }

  /** Renders the expression the way a stat block would, e.g. {@code "2d6 + 5"}. */
  public String expression() {
    if (isFlat()) {
      return bonus == null ? "" : String.valueOf(bonus);
    }
    StringBuilder sb = new StringBuilder().append(count).append('d').append(faces);
    if (bonus != null && bonus != 0) {
      sb.append(bonus > 0 ? " + " : " - ").append(Math.abs(bonus));
    }
    return sb.toString();
  }
}
