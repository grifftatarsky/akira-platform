package com.gpt.oozengine.model.battle;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An action that has been declared and has not resolved.
 *
 * <p>Persisted rather than held in a method, because the gap between declaring
 * and resolving is a state a DM sits in — they read the window, think, and come
 * back. A pending action that only existed inside a call would make the window a
 * blocking prompt rather than something a client can render and leave.
 *
 * <p>Amendments are written here as they are made, so the action that finally
 * resolves is the amended one and the log shows both what was declared and what
 * actually happened.
 */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
public class PendingAction {

  @Column(name = "pending_actor_id")
  private UUID actorId;

  @Column(name = "pending_feature_id")
  private UUID featureId;

  @Column(name = "pending_feature_name")
  private String featureName;

  /** Whom it is aimed at now — the amended list, not necessarily the declared one. */
  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "pending_target_ids", columnDefinition = "jsonb")
  private List<UUID> targetIds;

  /** The sequence of the ACTION_DECLARED event, so consequences can point at it. */
  @Column(name = "pending_declared_at")
  private Long declaredAt;

  /**
   * Added to the targets' Armor Class for this action only.
   *
   * <p>Shield and Parry, which raise a defence against one attack rather than
   * for a duration. Kept on the action rather than on the participant because
   * that is exactly its lifetime — the next attack must not inherit it.
   */
  @Column(name = "pending_armor_class_delta")
  private Integer armorClassDelta;

  @Column(name = "pending_cancelled")
  private Boolean cancelled;

  public boolean isPending() {
    return actorId != null;
  }

  public boolean wasCancelled() {
    return Boolean.TRUE.equals(cancelled);
  }

  /** Clears everything, for when the action has resolved or been abandoned. */
  public void clear() {
    actorId = null;
    featureId = null;
    featureName = null;
    targetIds = null;
    declaredAt = null;
    armorClassDelta = null;
    cancelled = null;
  }
}
