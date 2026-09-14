package com.gpt.oozengine.constant.rules;

/** The five movement modes a creature can have. Stored as a speed each, rather
 * than one string, so the simulator can ask whether something can cross the pit. */
public enum MovementType {
  WALK,
  BURROW,
  CLIMB,
  FLY,
  SWIM
}
