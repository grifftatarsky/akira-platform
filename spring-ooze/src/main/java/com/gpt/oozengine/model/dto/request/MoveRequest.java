package com.gpt.oozengine.model.dto.request;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/**
 * Where a creature is going.
 *
 * <p>Waypoints rather than a destination, because the route matters: what a
 * square costs, whose reach it leaves and how far it is down all depend on the
 * path taken, and two routes to the same spot can cost very different amounts.
 *
 * @param waypoints in half-feet, in order; the creature's current position is
 *     the implied start
 */
public record MoveRequest(@NotEmpty List<Waypoint> waypoints) {

  /** One point on the route. */
  public record Waypoint(Integer xHalfFeet, Integer yHalfFeet, Integer zHalfFeet) {

    public com.gpt.oozengine.util.Geometry.Point toPoint() {
      return new com.gpt.oozengine.util.Geometry.Point(
          xHalfFeet == null ? 0 : xHalfFeet,
          yHalfFeet == null ? 0 : yHalfFeet,
          zHalfFeet == null ? 0 : zHalfFeet);
    }
  }
}
