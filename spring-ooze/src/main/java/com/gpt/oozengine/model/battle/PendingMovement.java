package com.gpt.oozengine.model.battle;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A move that has been started and interrupted.
 *
 * <p>The SRD is specific about when an Opportunity Attack happens: "The attack
 * occurs right before the creature leaves your reach." So a move cannot be one
 * atomic hop from A to B — it has to be walkable, stoppable at the square that
 * provokes, and resumable once the reaction has landed.
 *
 * <p>The legs left to walk are kept here as JSON. A creature that is halfway
 * across a room while a DM decides whether the ogre swings at it is a real
 * state, and it has to survive the request that created it.
 */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
public class PendingMovement {

  @Column(name = "moving_participant_id")
  private UUID participantId;

  /**
   * The legs still to walk, each a map of the destination and what it costs.
   *
   * <p>Schemaless because the shape belongs to whoever computed it — the board
   * knows about elevation and terrain and the tracker does not, so the tracker
   * carries the answer rather than the reasoning.
   */
  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "moving_remaining_legs", columnDefinition = "jsonb")
  private List<Map<String, Object>> remainingLegs;

  @Column(name = "moving_declared_at")
  private Long declaredAt;

  public boolean isMoving() {
    return participantId != null;
  }

  public void clear() {
    participantId = null;
    remainingLegs = null;
    declaredAt = null;
  }
}
