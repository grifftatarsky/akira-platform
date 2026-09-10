package com.gpt.oozengine.model.encounter;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * How much tougher or weaker than the book this creature is.
 *
 * <p><b>A descriptor, not baked numbers.</b> "Make this a beefier goblin" stored
 * as {@code hitPointPercent = 150} stays legible and re-tunable a month later; a
 * cloned stat block with 11 written where 7 used to be does not, and nothing can
 * tell afterwards whether that 11 was a scale or a hand edit.
 *
 * <p><b>Percentages and deltas, both integers.</b> A multiplier of 1.5 invites a
 * float into a system that has worked hard to avoid them, and 150 says the same
 * thing exactly. 100 means unchanged, so a default-constructed Scaling is the
 * book.
 *
 * <p>Applied when a battle starts, never written back to the encounter — which
 * is what lets a DM dial a fight up, run it, dial it down and run it again.
 */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class Scaling {

  /** 100 is the book; 150 is half again as many hit points. */
  @Column(name = "hit_point_percent", nullable = false)
  private int hitPointPercent = 100;

  /** Added to Armor Class. Negative makes it easier to hit. */
  @Column(name = "armor_class_delta", nullable = false)
  private int armorClassDelta;

  /** 100 is the book. Applied to damage the creature deals. */
  @Column(name = "damage_percent", nullable = false)
  private int damagePercent = 100;

  /** Added to attack rolls. */
  @Column(name = "attack_bonus_delta", nullable = false)
  private int attackBonusDelta;

  /** Added to the DC of saves the creature forces. */
  @Column(name = "save_dc_delta", nullable = false)
  private int saveDcDelta;

  /** True when nothing here changes anything, which is the overwhelming case. */
  public boolean isUnchanged() {
    return hitPointPercent == 100 && damagePercent == 100
        && armorClassDelta == 0 && attackBonusDelta == 0 && saveDcDelta == 0;
  }

  /**
   * Scales a value by a percentage, never below 1.
   *
   * <p>Rounded rather than truncated, so 7 hit points at 150% is 11 rather than
   * 10 — and floored at 1, because a creature scaled to 10% of nothing is still
   * a creature rather than a corpse.
   */
  public static int percentOf(int value, int percent) {
    return Math.max(1, Math.round(value * percent / 100.0f));
  }

  public int hitPoints(int base) {
    return percentOf(base, hitPointPercent);
  }

  public int damage(int base) {
    return percentOf(base, damagePercent);
  }
}
