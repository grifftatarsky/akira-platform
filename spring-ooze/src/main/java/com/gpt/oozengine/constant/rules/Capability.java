package com.gpt.oozengine.constant.rules;

/**
 * A standing capability: something a creature may always do, or never do.
 *
 * <p>The third thing a passive trait can be, after a {@link RiderTarget rider}
 * that modifies a roll and a {@link TriggerEvent trigger} that fires on an
 * event. Amphibious, Spider Climb, Flyby and Swarm change no number and wait for
 * no event — they change what the rules <em>permit</em>, and the engine has to
 * ask before it refuses a move or charges double for one.
 *
 * <p>Named Capability rather than Permission because
 * {@code constant.security.Permission} already exists and means something
 * entirely different; two enums with one name in one codebase is a bug waiting
 * for an import.
 *
 * <p>Enumerated rather than free text because the engine consults these at
 * decision points it already has: may this creature enter that space, does
 * leaving this reach provoke, does this terrain cost double.
 */
public enum Capability {

  // region Breathing and environment
  /** Amphibious: air and water both. */
  BREATHE_AIR_AND_WATER,
  /** Water Breathing: water only, holding its breath {@code amount} minutes on land. */
  BREATHE_ONLY_WATER,
  /** Hold Breath, on a creature that otherwise breathes normally. */
  HOLD_BREATH,
  /** Limited Amphibiousness: both, but must submerge every {@code amount} hours. */
  MUST_SUBMERGE_PERIODICALLY,
  // endregion

  // region Movement
  /** Spider Climb: climbs difficult surfaces and ceilings with no check. */
  CLIMB_WITHOUT_CHECK,
  /** Ice Walk: ice and snow are neither slippery nor Difficult Terrain. */
  IGNORE_ICE_TERRAIN,
  /** Web Walker: webs impose no movement restriction. */
  IGNORE_WEB_TERRAIN,
  /** Amorphous, Compression, Air Form: fits through a space as narrow as an inch. */
  SQUEEZE_THROUGH_INCH,
  /** Swarm, Air Form, Water Form: may end movement inside another creature's space. */
  OCCUPY_CREATURE_SPACE,
  /** Earth Glide, Tunneler: burrows through solid rock. */
  BURROW_THROUGH_ROCK,
  /** Incorporeal Movement: passes through creatures and objects as Difficult Terrain. */
  MOVE_THROUGH_OBJECTS,
  /** Flyby, Agile: leaving a hostile reach provokes nothing. */
  NO_OPPORTUNITY_ATTACK_ON_EXIT,
  /** Standing Leap: jump distances that ignore the running-start rule. */
  FIXED_JUMP_DISTANCE,
  /** Jumper: jump distance off Dexterity rather than Strength. */
  JUMP_USES_DEXTERITY,
  /** Abduct: dragging a grappled creature costs no extra movement. */
  FREE_GRAPPLE_MOVEMENT,
  // endregion

  // region Body and form
  /** Immutable Form: cannot be shape-shifted, by itself or by anything else. */
  CANNOT_SHAPE_SHIFT,
  /** Ephemeral: cannot wear or carry anything. */
  CANNOT_CARRY,
  /** Beast of Burden: counts as one size larger for carrying capacity. */
  OVERSIZED_CARRYING_CAPACITY,
  // endregion

  /** Reactive: one Reaction on every turn, rather than one per round. */
  REACTION_EVERY_TURN,

  // region Senses and communication
  /** Ethereal Sight, Iron Scent, Treasure Sense: perceives a thing at {@code amount} feet. */
  DETECT_AT_RANGE,
  /** Telepathy tied to a specific creature or item, not the stat block's general kind. */
  BOUND_TELEPATHY,
  /** Speak with Beasts and Plants, Mimicry: communication the languages field cannot carry. */
  SPECIAL_COMMUNICATION,
  /** Shielded Mind, Inscrutable: cannot be read, scried or detected. */
  MIND_SHIELDED,
  // endregion

  /** Siege Monster: double damage to objects and structures. */
  DOUBLE_DAMAGE_TO_OBJECTS,

  /**
   * Something the book grants that no other value fits, kept with its prose.
   *
   * <p>Deliberately last and deliberately rare. A trait that lands here is still
   * representable — it shows on the creature and the DM can act on it — but it
   * is a prompt to add a real value, not a resting place.
   */
  OTHER
}
