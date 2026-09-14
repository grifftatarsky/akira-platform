package com.gpt.oozengine.model;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One of a class table's own columns at one level — "Rages", "2".
 *
 * <p>A list of these rather than a map because the order is the book's and has
 * to survive: a Barbarian's table reads Rages, then Rage Damage, then Weapon
 * Mastery, and a map comes back from the database in whatever order it likes.
 */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class ClassValue {

  @Column(nullable = false, length = 64)
  private String label;

  @Column(nullable = false, length = 32)
  private String value;
}
