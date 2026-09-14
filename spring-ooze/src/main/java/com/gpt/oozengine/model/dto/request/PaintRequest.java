package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.PaintShape;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * One stroke of terrain.
 *
 * <p>{@code brush} is the cell to stamp everywhere the stroke covers; its own
 * {@code x} and {@code y} are ignored, since the stroke supplies those. A null
 * field in the brush means "leave that attribute alone", which is what makes it
 * possible to raise the ground across a room without also repainting its
 * terrain.
 *
 * <p>Every optional scalar here is boxed. Jackson maps an omitted field to null
 * and a primitive rejects it outright, so a plain {@code boolean erase} makes
 * the ordinary stroke — the one that does not erase and therefore does not
 * mention erasing — a 400.
 *
 * @param erase clears the covered squares back to the map's defaults instead of
 *     stamping. The only way to unpaint without resending the whole canvas.
 */
public record PaintRequest(
    @NotNull PaintShape shape,
    @PositiveOrZero int x1,
    @PositiveOrZero int y1,
    @PositiveOrZero int x2,
    @PositiveOrZero int y2,
    Boolean erase,
    @Valid MapCellRequest brush) {

  /** Absent means "no", which is what an ordinary stroke leaves unsaid. */
  public boolean erasing() {
    return Boolean.TRUE.equals(erase);
  }
}