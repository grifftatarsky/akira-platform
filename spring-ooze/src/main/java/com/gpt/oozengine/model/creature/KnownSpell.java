package com.gpt.oozengine.model.creature;

import com.gpt.oozengine.constant.rules.UsesReset;
import com.gpt.oozengine.model.Spell;
import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A spell a stat block can cast, and on what allowance.
 *
 * <p>Monster spellcasting is not a spell list plus slots — it is "At Will:
 * Detect Magic" and "1/Day Each: Dominate Person". {@link #usesMax} with
 * {@link #usesReset} covers both, and {@link #spellLevel} is denormalised from
 * the spell so the list can be grouped without loading every spell row.
 */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class KnownSpell {

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "spell_id", nullable = false)
  @EqualsAndHashCode.Include
  private Spell spell;

  @Column(name = "spell_level", nullable = false)
  private int spellLevel;

  @Enumerated(EnumType.STRING)
  @Column(name = "uses_reset", nullable = false, length = 16)
  private UsesReset usesReset = UsesReset.AT_WILL;

  @Column(name = "uses_max")
  private Integer usesMax;
}
