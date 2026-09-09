package com.gpt.oozengine.constant.rules;

/**
 * A thing standing on the board that is not terrain.
 *
 * <p><b>Placed, not derived.</b> That is the whole distinction: a floor piece
 * and a wall piece are chosen by the square underneath them, so they are not
 * here — no rule about a square produces "and the barrels are stacked in that
 * corner". Somebody decided that.
 *
 * <p><b>Decoration today, and an enum anyway.</b> A free-text piece name would
 * have been less to write and would have made every one of these permanently
 * unknowable: the engine cannot ask "is there a table here" of a string somebody
 * typed. Half this list is a rule waiting to be modelled — a table and a
 * barricade are Half Cover, a torch is a 20-foot bright radius, a chest is a
 * container — and when those arrive they arrive as behaviour on a value that is
 * already correct in every saved encounter. A pack that wants a piece this list
 * lacks needs one line here, which is the price of that.
 *
 * <p>Named for what the thing is, never for the file that draws it. The art is
 * swappable by design; a DM who replaces KayKit with their own pack changes the
 * theme and not one row of anybody's saved board.
 */
public enum PropKind {

  // Structure a DM places rather than paints. A doorway stands on a *floor*
  // square — the gap in the wall is passable, and a door that was a wall would
  // seal the room it opens.
  DOORWAY,
  WALL_ARCH,
  WALL_CORNER,
  WALL_TSPLIT,
  PILLAR,
  PILLAR_DECORATED,
  COLUMN,
  STAIRS,
  BARRIER,

  // Storage and furniture.
  BARREL,
  BARRELS,
  CRATE,
  CRATES,
  CHEST,
  TRUNK,
  KEG,
  SHELVES,
  SHELF_CANDLES,
  TABLE,
  TABLE_BROKEN,
  CHAIR,
  STOOL,
  BED,

  // Light, which is the one of these the engine will want first.
  TORCH,
  CANDLES,

  // Dressing.
  BANNER_BLUE,
  BANNER_GREEN,
  RUBBLE,
  RUBBLE_SMALL,
  ARMS,
  COINS,
  BOTTLE,
  PLATE,
}
