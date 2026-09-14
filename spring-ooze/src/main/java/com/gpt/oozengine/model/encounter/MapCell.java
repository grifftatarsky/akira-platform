package com.gpt.oozengine.model.encounter;

import com.gpt.oozengine.constant.rules.CoverDegree;
import com.gpt.oozengine.constant.rules.LightLevel;
import com.gpt.oozengine.constant.rules.TerrainKind;
import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One painted square, stored only because it differs from the map's defaults.
 *
 * <p>Every field is nullable and means "unchanged" when null, so a cell that
 * only raises the ground carries an elevation and nothing else.
 */
@Entity
@Table(name = "map_cells")
@Getter
@Setter
@NoArgsConstructor
public class MapCell extends BaseEntity {

  @Column(name = "battle_map_id", insertable = false, updatable = false)
  private UUID battleMapId;

  /** Cell index, not a distance. Multiply by the map's {@code cellFeet} for position. */
  @Column(nullable = false)
  private int x;

  @Column(nullable = false)
  private int y;

  /**
   * Height of the ground here, in feet. Falling off it is real damage: "1d6
   * Bludgeoning for every 10 feet, max 20d6", and Prone on landing. Slope is
   * derived by comparing neighbours rather than stored, because a stored slope
   * and stored neighbours can disagree.
   */
  @Column(name = "elevation_feet")
  private Integer elevationFeet;

  @Enumerated(EnumType.STRING)
  @Column(length = 16)
  private TerrainKind terrain;

  @Enumerated(EnumType.STRING)
  @Column(length = 16)
  private LightLevel light;

  /**
   * What a creature behind this square gains. Note "behind": the cover belongs
   * to the obstacle, and the engine works out who is sheltered by tracing.
   */
  @Enumerated(EnumType.STRING)
  @Column(length = 16)
  private CoverDegree cover;

  /** Blocks line of sight. Null means "whatever the terrain implies". */
  @Column(name = "opaque")
  private Boolean opaque;

  /**
   * Extra feet it costs to enter, on top of the usual 5.
   *
   * <p>Difficult Terrain, per the book: "every foot of movement in that space
   * costs 1 extra foot… isn't cumulative". Static cost only — a square is also
   * Difficult Terrain when it holds "a creature that isn't Tiny or your ally",
   * and that depends on who is standing there and who is asking, so it is
   * computed at move time and never written here.
   */
  @Column(name = "extra_move_cost_feet")
  private Integer extraMoveCostFeet;

  @Column(columnDefinition = "text")
  private String notes;
}
