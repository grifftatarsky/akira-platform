package com.gpt.oozengine.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One step of a move: where it ends, what it costs, and what it disturbs.
 *
 * <p>Computed by whoever has a board and handed to a tracker that has none. The
 * cost already includes the live half of Difficult Terrain — a square is
 * difficult when it holds "a creature that isn't Tiny or your ally", so the same
 * step costs different movers different amounts and could never have been
 * cached on the square.
 *
 * @param provokesFrom creatures whose reach this step leaves, who may take an
 *     Opportunity Attack "right before the creature leaves your reach"
 * @param fallFeet how far the creature drops arriving here, if it does
 */
public record MovementLeg(
    int x,
    int y,
    int z,
    int costFeet,
    List<UUID> provokesFrom,
    int fallFeet) {

  public boolean provokes() {
    return provokesFrom != null && !provokesFrom.isEmpty();
  }

  /** Flattened for the pending-movement blob, which the tracker stores blind. */
  public Map<String, Object> toMap() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("x", x);
    out.put("y", y);
    out.put("z", z);
    out.put("costFeet", costFeet);
    out.put("fallFeet", fallFeet);
    out.put("provokesFrom", provokesFrom == null ? List.of()
        : provokesFrom.stream().map(UUID::toString).toList());
    return out;
  }

  public static MovementLeg fromMap(Map<String, Object> m) {
    List<UUID> provokes = new ArrayList<>();
    Object raw = m.get("provokesFrom");
    if (raw instanceof List<?> list) {
      list.forEach(v -> provokes.add(UUID.fromString(String.valueOf(v))));
    }
    return new MovementLeg(intOf(m, "x"), intOf(m, "y"), intOf(m, "z"),
        intOf(m, "costFeet"), provokes, intOf(m, "fallFeet"));
  }

  private static int intOf(Map<String, Object> m, String key) {
    Object v = m.get(key);
    return v instanceof Number n ? n.intValue() : 0;
  }
}
