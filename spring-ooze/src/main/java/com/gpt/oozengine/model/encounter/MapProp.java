package com.gpt.oozengine.model.encounter;

import com.gpt.oozengine.constant.rules.PropKind;

/**
 * One prop, somewhere on the board.
 *
 * <p>A value inside the map's {@code props} JSON rather than an entity, because
 * nothing refers to a prop: it is written whole with the map, read whole with
 * the map, and never joined to. An id per barrel would be an id nothing uses.
 *
 * <p><b>Position is continuous, like a creature's, and not a cell index like a
 * painted square's.</b> Terrain is a raster and furniture is not — a table
 * stands across the middle of two squares if that is where somebody put it, and
 * snapping it to a grid would make the board less true to a tabletop rather than
 * more.
 *
 * @param xHalfFeet centre, in half-feet — the engine's unit everywhere
 * @param zHalfFeet height above the *ground under it*, not above zero, so a
 *     chest carried onto a ten-foot dais does not need its elevation edited and
 *     one saved at zero can never end up buried in the plinth
 * @param facingDegrees clockwise about the vertical, 0 to 359. Degrees because
 *     they are whole numbers, matching every other measurement here; radians
 *     would put the one floating-point value in the schema on the least
 *     important field in it.
 */
public record MapProp(
    PropKind piece,
    int xHalfFeet,
    int yHalfFeet,
    int zHalfFeet,
    int facingDegrees) {}
