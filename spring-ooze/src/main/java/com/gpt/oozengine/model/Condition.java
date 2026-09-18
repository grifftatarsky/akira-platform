package com.gpt.oozengine.model;

import com.gpt.oozengine.constant.rules.ConditionCode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Conditions — Blinded, Prone, Stunned, and the rest. */
@Entity
@Table(name = "conditions")
@Getter
@Setter
@NoArgsConstructor
public class Condition extends CatalogContent {

  /**
   * The rule this row represents, or null for a DM's homebrew condition. The
   * table owns the text and who may edit it; the code is what the simulator
   * switches on, so a homebrew condition displays and links like any other while
   * the engine simply has no behaviour for it.
   */
  @Enumerated(EnumType.STRING)
  @Column(length = 24)
  private ConditionCode code;

  @Column(nullable = false, columnDefinition = "text")
  private String description;
}
