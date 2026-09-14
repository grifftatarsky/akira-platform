package com.gpt.oozengine.constant.rules;

/**
 * How dangerous a trap is meant to be for the tier it is placed in.
 *
 * <p>The book pairs a severity with a level band — "Deadly Trap (Levels 1-4)" —
 * and a trap can print two, the same trap being deadly to one tier and a
 * nuisance to another. The severity here is the first the book gives.
 */
public enum TrapSeverity {
  NUISANCE,
  BANE,
  DEADLY
}
