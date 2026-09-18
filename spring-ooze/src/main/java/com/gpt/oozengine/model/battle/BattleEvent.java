package com.gpt.oozengine.model.battle;

import com.gpt.oozengine.constant.rules.BattleEventType;
import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One thing that happened, immutably.
 *
 * <p>Append-only. Nothing edits an event; a mistake is undone by truncating the
 * log after it and folding the remainder, which is the same fight one step
 * earlier rather than a different fight patched to look like it.
 */
@Entity
@Table(name = "battle_events")
@Getter
@Setter
@NoArgsConstructor
public class BattleEvent extends BaseEntity {

  @Column(name = "battle_id", insertable = false, updatable = false)
  private UUID battleId;

  /** Monotonic within a battle, and the thing undo truncates on. */
  @Column(nullable = false)
  private long sequence;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 40)
  private BattleEventType type;

  /** The round this happened in; 0 before the fight starts. */
  @Column(nullable = false)
  private int round;

  /** Who did it, or whom it happened to. Null for events about the battle itself. */
  @Column(name = "participant_id")
  private UUID participantId;

  /**
   * What another event caused this one.
   *
   * <p>Unused in phase 3 and load-bearing in phase 5: a reaction points at the
   * declaration it interrupted, which is how a counterspell can be shown as an
   * answer to a spell rather than as an unrelated thing that happened next.
   */
  @Column(name = "caused_by_sequence")
  private Long causedBySequence;

  /**
   * The numbers, as JSON.
   *
   * <p>Schemaless on purpose. An initiative roll carries dice and a bonus, a hit
   * point change carries a delta and a reason, and a note carries prose — a
   * column per shape would be a migration for every new event type and null on
   * every row but one.
   */
  @JdbcTypeCode(SqlTypes.JSON)
  @Column(columnDefinition = "jsonb")
  private Map<String, Object> payload;

  /** One line a DM can read, written when the event is made. */
  @Column(columnDefinition = "text", nullable = false)
  private String summary;
}
