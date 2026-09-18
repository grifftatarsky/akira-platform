package com.gpt.oozengine.model;

import com.gpt.oozengine.constant.rules.TrapSeverity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A trap, as the Gameplay Toolbox prints one: a severity for the tier it suits,
 * what sets it off, and how long it lasts.
 *
 * <p>Its own catalog type rather than a monster without ability scores or an
 * item nobody carries. A trap is the third thing that can act in an encounter,
 * and the simulator will ask it the same questions it asks a creature — when do
 * you go off, who do you hit, what do they roll.
 */
@Entity
@Table(name = "traps")
@Getter
@Setter
@NoArgsConstructor
public class Trap extends CatalogContent {

  @Enumerated(EnumType.STRING)
  @Column(length = 16)
  private TrapSeverity severity;

  /** The tier the severity is quoted for — "1-4", "11-16". */
  @Column(name = "level_band", length = 16)
  private String levelBand;

  /**
   * The severity line as printed. Rolling Stone is "Deadly Trap (Levels 11-16)
   * or Nuisance Trap (Levels 17-20)", and the second half is a real rule that
   * one severity and one band can't hold.
   */
  @Column(name = "severity_note")
  private String severityNote;

  @Column(columnDefinition = "text")
  private String trigger;

  private String duration;

  @Column(nullable = false, columnDefinition = "text")
  private String description;
}
