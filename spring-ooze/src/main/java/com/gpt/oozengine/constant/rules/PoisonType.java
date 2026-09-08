package com.gpt.oozengine.constant.rules;

/**
 * How a poison is delivered, which is the whole of what separates one from
 * another mechanically: contact poison needs exposed skin, injury poison needs
 * a weapon, and inhaled poison affects everyone in a 5-foot Cube.
 */
public enum PoisonType {
  CONTACT,
  INGESTED,
  INHALED,
  INJURY
}
