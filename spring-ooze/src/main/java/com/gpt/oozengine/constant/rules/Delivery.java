package com.gpt.oozengine.constant.rules;

/**
 * How a feature decides whether it lands. These are the three sentence forms the
 * 2024 stat block uses, and they map one-to-one onto what the simulator rolls:
 * {@link #ATTACK_ROLL} rolls d20 + bonus against AC, {@link #SAVING_THROW} makes
 * the target roll against a DC, and {@link #AUTOMATIC} just happens.
 */
public enum Delivery {
  AUTOMATIC,
  ATTACK_ROLL,
  SAVING_THROW,
  ABILITY_CONTEST
}
