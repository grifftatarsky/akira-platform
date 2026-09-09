package com.gpt.oozengine.model.encounter;

import com.gpt.oozengine.constant.rules.LightLevel;
import com.gpt.oozengine.constant.rules.TerrainKind;
import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * The battlefield: a raster of terrain, and the defaults most of it uses.
 *
 * <p><b>Terrain is a grid; placement is not.</b> Terrain is painted, so it
 * stores as cells — but a token sits at a continuous position and merely samples
 * the raster underneath it. {@link #cellFeet} is the resolution of the painting
 * and nothing else.
 *
 * <p><b>Cells are sparse.</b> A row exists only where the square differs from
 * the defaults below. A 40x40 board is 1,600 squares and nearly all of them are
 * plain lit floor, so storing them all would be 1,600 rows saying nothing.
 */
@Entity
@Table(name = "battle_maps")
@Getter
@Setter
@NoArgsConstructor
public class BattleMap extends BaseEntity {

  /** Width in cells. */
  @Column(nullable = false)
  private int width = 20;

  /** Height in cells. */
  @Column(nullable = false)
  private int height = 20;

  /** How many feet one cell is on a side. Five, unless a DM wants finer terrain. */
  @Column(name = "cell_feet", nullable = false)
  private int cellFeet = 5;

  @Enumerated(EnumType.STRING)
  @Column(name = "default_terrain", nullable = false, length = 16)
  private TerrainKind defaultTerrain = TerrainKind.FLOOR;

  @Enumerated(EnumType.STRING)
  @Column(name = "default_light", nullable = false, length = 16)
  private LightLevel defaultLight = LightLevel.BRIGHT;

  /** Only the squares that differ from the defaults. */
  @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  @JoinColumn(name = "battle_map_id", nullable = false)
  private List<MapCell> cells = new ArrayList<>();
}
