package com.gpt.oozengine.model.creature;

import com.gpt.oozengine.constant.rules.SenseType;
import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One special sense and how far it reaches, e.g. {@code Darkvision 120 ft.} */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class SenseRange {

  @Enumerated(EnumType.STRING)
  @Column(name = "sense_type", nullable = false, length = 20)
  private SenseType senseType;

  @Column(name = "range_feet", nullable = false)
  private int rangeFeet;
}
