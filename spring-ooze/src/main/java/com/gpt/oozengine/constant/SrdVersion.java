package com.gpt.oozengine.constant;

/**
 * Which System Reference Document a base catalog row was taken from.
 *
 * <p>This has to travel with the row rather than being a site-wide constant:
 * each SRD is its own CC-BY grant with its own required attribution string, and
 * the two describe different rules editions (5.2 is the 2024 rules, 5.1 the
 * 2014 ones). A page showing both owes both attributions.
 *
 * <p>{@code null} on a row means it is not SRD content at all — a DM's own
 * creation. See {@link com.gpt.oozengine.model.CatalogContent}.
 *
 * <p>{@link #SRD_5_2} covers SRD 5.2.0 and 5.2.1 alike. The .1 revision added
 * front matter to the monsters chapter and repaginated; every rules page we
 * actually read from is byte-identical between them, so splitting the enum
 * would record a difference that doesn't exist in our data.
 */
public enum SrdVersion {
  /** The 2024 rules. Our default: this is the edition Oozengine represents. */
  SRD_5_2,
  /** The 2014 rules. Only for content SRD 5.2 has no equivalent of. */
  SRD_5_1
}
