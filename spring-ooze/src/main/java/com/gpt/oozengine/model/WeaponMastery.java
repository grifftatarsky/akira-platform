package com.gpt.oozengine.model;

import com.gpt.oozengine.constant.rules.MasteryCode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.BatchSize;

/** Weapon mastery properties — Cleave, Topple, Vex, and the rest (2024). */
// Batched for the same reason the properties are: the Mastery column is a
// link every weapon on a page follows.
@BatchSize(size = 64)
@Entity
@Table(name = "weapon_masteries")
@Getter
@Setter
@NoArgsConstructor
public class WeaponMastery extends CatalogContent {

  /** Behavioural handle; null for homebrew. See {@link Condition#getCode()}. */
  @Enumerated(EnumType.STRING)
  @Column(length = 16)
  private MasteryCode code;

  @Column(nullable = false, columnDefinition = "text")
  private String description;
}
