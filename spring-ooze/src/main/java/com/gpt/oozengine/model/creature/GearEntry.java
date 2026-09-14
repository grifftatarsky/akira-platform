package com.gpt.oozengine.model.creature;

import com.gpt.oozengine.model.Item;
import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One entry from a stat block's "Gear" line — "Javelins (6)" is quantity 6. */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class GearEntry {

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "item_id", nullable = false)
  @EqualsAndHashCode.Include
  private Item item;

  @Column(nullable = false)
  private int quantity = 1;
}
