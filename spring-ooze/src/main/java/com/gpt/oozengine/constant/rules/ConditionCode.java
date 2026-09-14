package com.gpt.oozengine.constant.rules;

/**
 * The 15 conditions the rules define, as a handle the engine can switch on.
 *
 * <p>Conditions are also catalog content — a DM can reword one, and a homebrew
 * condition is a legitimate row — so the table stays authoritative for text and
 * ownership while this enum stays authoritative for behaviour. A row with no code
 * is homebrew: it displays, and the simulator has no opinion about it.
 */
public enum ConditionCode {
  BLINDED,
  CHARMED,
  DEAFENED,
  EXHAUSTION,
  FRIGHTENED,
  GRAPPLED,
  INCAPACITATED,
  INVISIBLE,
  PARALYZED,
  PETRIFIED,
  POISONED,
  PRONE,
  RESTRAINED,
  STUNNED,
  UNCONSCIOUS
}
