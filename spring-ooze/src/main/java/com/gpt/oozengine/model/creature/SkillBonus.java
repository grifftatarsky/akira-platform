package com.gpt.oozengine.model.creature;

import com.gpt.oozengine.constant.rules.Skill;
import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One line of a stat block's "Skills" entry, e.g. {@code History +12}. */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class SkillBonus {

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 24)
  private Skill skill;

  @Column(nullable = false)
  private int bonus;
}
