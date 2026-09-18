package com.gpt.oozengine.constant.rules;

/**
 * Why a resolution step happens at all.
 *
 * <p>The book chains steps: a Ghoul's Claw is an attack, and <em>then</em>, only
 * on a hit, a Constitution save against paralysis. Modelling that as a condition
 * on the step is what lets the simulator stop after a miss instead of applying
 * the rider anyway.
 */
public enum StepTrigger {
  ALWAYS,
  ON_PREVIOUS_HIT,
  ON_PREVIOUS_MISS,
  ON_PREVIOUS_FAILURE,
  ON_PREVIOUS_SUCCESS
}
