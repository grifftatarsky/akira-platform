package com.gpt.oozengine.constant.rules;

/**
 * Which branch of a resolution step an effect belongs to. The names mirror
 * the SRD's own labels — a stat block literally prints "Hit:", "Failure:",
 * "Success:" and "Failure or Success:" — so an importer maps them directly and
 * the simulator switches on them without interpretation.
 */
public enum EffectOutcome {
  ALWAYS,
  HIT,
  CRITICAL_HIT,
  MISS,
  HIT_OR_MISS,
  SAVE_FAILURE,
  SAVE_SUCCESS,
  SAVE_EITHER,
  /**
   * The escalating branches the book uses for effects that worsen as a target
   * keeps failing — a Cockatrice's bite Restrains on the first failure and
   * Petrifies on the second.
   */
  FIRST_FAILURE,
  SECOND_FAILURE,
  SUBSEQUENT_FAILURES,
  FAILURE_BY_5_OR_MORE
}
