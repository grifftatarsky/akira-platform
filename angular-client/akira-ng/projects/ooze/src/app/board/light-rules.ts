import { PropKind } from './board.models';

/**
 * What burns on the board, and how far it reaches.
 *
 * <p>All that survives of `light-field.ts`, which baked a room's illumination
 * into a small blurred image because a forward renderer could not afford
 * twenty real lights. Clustered lighting can, so the bake is gone and these
 * are lights again — but the *numbers* were never rendering. They are the
 * SRD's, and they belong to the game rather than to whatever draws it.
 */

/** What a flame adds, on top of whatever the square's level already was. */
export const FLAME_COLOR: readonly [number, number, number] = [1, 0.6, 0.26];

/** One thing that burns: how far it reaches and how hard. */
export interface LightSource {
  /** Half-feet of full brightness. */
  readonly bright: number;
  /** Half-feet at which it has died entirely. */
  readonly dim: number;
  readonly strength: number;
}

/**
 * How far a light reaches, in half-feet: full out to the first, gone by the
 * second.
 *
 * <p>The SRD's own numbers. A torch "casts Bright Light in a 20-foot radius and
 * Dim Light for an additional 20 feet", so the ramp is not a lighting artist's
 * choice — it is the rule, drawn.
 */
const REACH: Partial<Record<PropKind, LightSource>> = {
  // Strong enough to be the thing lighting the room rather than a highlight on
  // a room that was already lit. That is the difference between a dungeon and a
  // diagram of one — and it is why the sample level's rooms are Dim: a torchlit
  // hall *is* dim, twenty feet from a torch.
  TORCH: { bright: 40, dim: 80, strength: 0.95 },
  CANDLES: { bright: 10, dim: 20, strength: 0.35 },
  SHELF_CANDLES: { bright: 10, dim: 20, strength: 0.35 },
};

/** Whether a prop is on fire, and how brightly. Null for anything that is not. */
export function lightSource(piece: PropKind): LightSource | null {
  return REACH[piece] ?? null;
}
