package com.gpt.oozengine.constant.rules;

/**
 * What it costs to use a feature. The action economy is the spine of the
 * simulator's turn loop: a creature gets one {@link #ACTION}, one
 * {@link #BONUS_ACTION} and one {@link #REACTION} per round, while
 * {@link #LEGENDARY} fires between other creatures' turns and {@link #PASSIVE}
 * never fires at all — it is always on.
 *
 * <p>{@link #TIMED} covers anything measured in minutes or longer (rituals, an
 * 8-hour casting); the amount lives alongside in {@code activationTime} +
 * {@link TimeUnit}, because "1 minute" and "24 hours" are the same kind of cost.
 */
public enum Activation {
  PASSIVE,
  ACTION,
  BONUS_ACTION,
  REACTION,
  FREE,
  LEGENDARY,
  LAIR,
  TIMED,
  SPECIAL
}
