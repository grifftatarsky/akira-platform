package com.gpt.oozengine.model.mechanics;

import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.MovementType;
import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.MapKeyEnumerated;
import jakarta.persistence.Table;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One form a shape-shifting creature can take.
 *
 * <p>The book is consistent about what changes: "Other than its size, its game
 * statistics are the same in each form." So a form carries a size and a set of
 * speeds and nothing else — the quasit's bat is "Speed 10 ft., Fly 40 ft.",
 * not a second stat block.
 *
 * <p>Size is the mechanically live part. It sets the creature's footprint, the
 * footprint sets reach and cover, and both are measured edge to edge, so a hag
 * dropping from Large to Medium genuinely changes who it can hit.
 */
@Entity
@Table(name = "shape_options")
@Getter
@Setter
@NoArgsConstructor
public class ShapeOption extends BaseEntity {

  @Column(name = "feature_id", insertable = false, updatable = false)
  private UUID featureId;

  /** Position within the feature's list, so the book's order survives. */
  @Column(nullable = false)
  private int ordinal;

  /** "bat", "Small or Medium Humanoid", or "true form". */
  @Column(nullable = false)
  private String name;

  /** Null when the book leaves it to the DM ("a Small or Medium Humanoid"). */
  @Enumerated(EnumType.STRING)
  @Column(length = 16)
  private CreatureSize size;

  /** Empty means "unchanged", which is the common case for a humanoid form. */
  @ElementCollection
  @CollectionTable(name = "shape_option_speeds", joinColumns = @JoinColumn(name = "shape_option_id"))
  @MapKeyColumn(name = "movement_type")
  @MapKeyEnumerated(EnumType.STRING)
  @Column(name = "speed_feet", nullable = false)
  private Map<MovementType, Integer> speeds = new EnumMap<>(MovementType.class);

  /** True for the entry that returns the creature to what it really is. */
  @Column(name = "true_form", nullable = false)
  private boolean trueForm;
}
