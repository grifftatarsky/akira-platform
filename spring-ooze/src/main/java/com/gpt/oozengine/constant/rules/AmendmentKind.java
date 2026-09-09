package com.gpt.oozengine.constant.rules;

/**
 * What a reaction does to the action it interrupted.
 *
 * <p>Three verbs, not one. Cancelling is the easy case and the misleading one:
 * building only that makes Shield and Redirect Attack unaddable later without
 * reshaping the pipeline, because neither stops the action — they change it
 * while it is in flight.
 */
public enum AmendmentKind {
  /** Nothing changes; the action resolves as declared. */
  PROCEED,

  /** Counterspell. The action does not happen at all. */
  CANCEL,

  /**
   * Redirect Attack: "the goblin and that ally swap places, and the ally becomes
   * the target of the attack instead". The action still happens, to somebody
   * else.
   */
  RETARGET,

  /**
   * Shield, Parry, Protection: the action still happens, to the same creature,
   * against a different number. "The bandit adds 2 to its AC against that
   * attack, possibly causing it to miss."
   */
  MODIFY_DEFENCE
}
