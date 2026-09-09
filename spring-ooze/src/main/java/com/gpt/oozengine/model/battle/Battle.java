package com.gpt.oozengine.model.battle;

import com.gpt.oozengine.constant.rules.BattlePhase;
import com.gpt.oozengine.model.BaseEntity;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.BatchSize;

/**
 * One playthrough: an initiative order, a round counter, and a log.
 *
 * <p><b>This is the tracker, and it knows nothing about maps.</b> There is no
 * terrain here, no geometry and no reference to a battlefield — only who is in
 * the fight, in what order, and what has happened. That is deliberate: an
 * initiative tracker is useful at a table on its own, and the simulator supplies
 * a board to something that would work just as well without one.
 *
 * <p>{@link #encounterId} is the only thread back, and it is nullable. A battle
 * started from an encounter remembers where it came from; one started from
 * nothing is just as valid.
 *
 * <p><b>The log is the battle.</b> {@link #events} is append-only and live state
 * is a fold over it, materialised onto the participants so reads stay cheap.
 * That makes undo a truncation rather than a pile of inverse operations, and it
 * means the combat log a DM reads can never disagree with the state the engine
 * holds.
 */
@Entity
@Table(name = "battles")
@Getter
@Setter
@NoArgsConstructor
public class Battle extends BaseEntity {

  @Column(name = "owner_id", nullable = false)
  private UUID ownerId;

  @Column(nullable = false)
  private String name;

  /** Where it was set up, if it was. Null for a tracker used on its own. */
  @Column(name = "encounter_id")
  private UUID encounterId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 24)
  private BattlePhase phase = BattlePhase.SETUP;

  /** 1 on the first round. 0 while the fight has not started. */
  @Column(nullable = false)
  private int round;

  /**
   * Whose turn it is: an index into the initiative order.
   *
   * <p>An index rather than a participant reference, because the order is the
   * thing being walked and a reference would have to be kept in step with it.
   */
  @Column(name = "turn_index", nullable = false)
  private int turnIndex;

  /**
   * The battle's dice.
   *
   * <p>Stored so a battle is reproducible: with the seed and the log, the same
   * fight can be replayed to any point and will roll the same numbers. Without
   * it, undo would rewind into a different fight.
   */
  @Column(nullable = false)
  private long seed;

  /** How many rolls have been made, and so the index the next one uses. */
  @Column(name = "roll_count", nullable = false)
  private long rollCount;

  /** The next sequence number the log will use. */
  @Column(name = "next_sequence", nullable = false)
  private long nextSequence = 1;

  /**
   * The action waiting on a reaction window, if any.
   *
   * <p>Embedded rather than a table: there is at most one at a time, because the
   * engine stops when it needs a decision and does not start another action
   * until this one settles.
   */
  @Embedded
  private PendingAction pending = new PendingAction();

  /**
   * Never null, whatever Hibernate loaded.
   *
   * <p>An {@code @Embedded} whose columns are all null comes back as a null
   * embeddable, not an empty one — so a battle with nothing pending reads as a
   * battle with no pending *object*, and the field initialiser above is no help
   * because Hibernate never runs it on a load. Written out rather than left to
   * Lombok for exactly that reason.
   */
  public PendingAction getPending() {
    if (pending == null) {
      pending = new PendingAction();
    }
    return pending;
  }

  @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  @JoinColumn(name = "battle_id", nullable = false)
  @OrderBy("initiative DESC, initiativeTiebreak DESC, id ASC")
  @BatchSize(size = 64)
  private List<Participant> participants = new ArrayList<>();

  @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
  @JoinColumn(name = "battle_id", nullable = false)
  @OrderBy("sequence ASC")
  @BatchSize(size = 128)
  private List<BattleEvent> events = new ArrayList<>();
}
