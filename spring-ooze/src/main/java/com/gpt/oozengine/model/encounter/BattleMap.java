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
import org.hibernate.annotations.BatchSize;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
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
  @BatchSize(size = 64)
  private List<MapCell> cells = new ArrayList<>();

  /**
   * The furniture, as JSON rather than as rows.
   *
   * <p>Cells earn a table because the engine reads them one square at a time on
   * every step of every move. Props are never asked about: they are written
   * whole and read whole, nothing joins to them, and a table would add a query
   * to every board load to fetch a list that always travels with the map
   * anyway.
   *
   * <p><b>Decoration, and deliberately not terrain.</b> A square is Difficult to
   * cross and gives Half Cover because the cell says so — never because a
   * barricade is drawn on it. Keeping those apart means a DM can furnish a room
   * without changing one thing the engine computes, and furniture can never
   * quietly become a rule nobody agreed to.
   */
  @JdbcTypeCode(SqlTypes.JSON)
  @Column(columnDefinition = "jsonb")
  private List<MapProp> props = new ArrayList<>();

  /**
   * The furniture, never null.
   *
   * <p>The field's initialiser is not enough: a map saved before this column
   * existed reads back as a null jsonb, and Hibernate sets the field to that
   * null rather than leaving the initialised list alone. Exactly the way a
   * fully-null {@code @Embedded} comes back null on the battle tracker, and
   * exactly as much of an NPE on the first read.
   */
  public List<MapProp> getProps() {
    if (props == null) {
      props = new ArrayList<>();
    }
    return props;
  }
}
