# Board assets

Checked on 2026-09-09. Every licence below was read from the source, not
recalled — this project already carries one attribution obligation for SRD 5.2
under CC-BY 4.0, and a second one acquired by accident is the kind of thing
nobody discovers until it matters.

## The rule

**Prefer CC0.** It needs no attribution, no credits page and no bookkeeping, and
the best sources for exactly this kind of art are CC0 anyway. Every pack below
marked CC0 can be dropped in and forgotten.

**CC-BY is fine but costs something.** It needs a credit, and the dashboard's SRD
block is where one would go — it already exists and already explains a licence,
so a second paragraph there is cheap. Only take on CC-BY when the asset is
genuinely better than the CC0 alternative.

**Avoid CC-BY-SA and GPL assets outright.** Share-alike is the trap: the terms
reach into what you build around the asset, and untangling that later means
re-sourcing art from a shipped product. OpenGameArt in particular mixes CC0,
CC-BY, CC-BY-SA and GPL submissions on the same site — its search has a CC0
filter, and it should always be on.

## 3D — the direction of travel

| Source | Licence | What it gives |
|---|---|---|
| [KayKit Dungeon Remastered](https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0) | **CC0** | 200+ modular dungeon pieces — walls, floors, stairs, doors, chests, barrels, traps, banners. FBX, **glTF**, OBJ. The best single starting point. |
| [Kenney — Mini Dungeon](https://kenney.nl/assets/mini-dungeon) | **CC0** | 20 dungeon models in OBJ, FBX and glTF. Small, clean, and the same author as most of the 2D below. |
| [Quaternius](https://quaternius.com/) | **CC0** | Low-poly modular dungeon and character packs; useful for placeholder minis. |
| [Poly Haven](https://polyhaven.com/license) | **CC0** | HDRIs, textures and models. The HDRIs matter later: one environment map is the difference between a lit scene and a flat one. |
| [ambientCG](https://docs.ambientcg.com/license/) | **CC0** | PBR texture sets — stone, wood, dirt. What the terrain materials will want when they stop being flat colours. |

**Ask for glTF/GLB.** three has a first-party `GLTFLoader`, and glTF is a runtime
format — FBX and OBJ are authoring formats that need conversion and carry more
than the renderer wants. Every pack above ships glTF.

## 2D — what the top-down board can use now

| Source | Licence | What it gives |
|---|---|---|
| [Kenney — Isometric Dungeon Tiles](https://kenney.nl/assets/isometric-dungeon-tiles) | **CC0** | 70+ tiles with both isometric and **top-down** views. |
| [Kenney — Roguelike Caves & Dungeons](https://kenney.nl/assets/roguelike-caves-dungeons) | **CC0** | 520 assets. Caves, dungeons, props. |
| [OpenGameArt — Top Down Dungeon Pack](https://opengameart.org/content/top-down-dungeon-pack) | **CC0** | 2 256 top-down tiles at 64×64: 28 wall variations, 14 floor. Seamless. |
| [Kenney — Tiny Dungeon](https://kenney.nl/assets/tiny-dungeon) | **CC0** | 130+ tiles plus a Tiled map sample. |

[Kenney](https://kenney.nl/) hosts 60 000+ CC0 assets and is the safest single
place to start: everything there is CC0, with no registration and no tracking.

## Icons

[game-icons.net](https://game-icons.net/about.html) is **CC-BY 3.0** — the one
worthwhile exception to the CC0 preference. Several thousand icons, and the
conditions the engine models (Prone, Poisoned, Frightened, Grappled…) all have
one, which nothing CC0 covers as completely.

The credit it asks for is *"Icons made by {author}. Available on
https://game-icons.net"*, and the authors are per-icon, so the set actually used
has to be tracked. That is the cost; it is worth paying once for status icons
and not worth paying twice.

## What is vendored here

`public/assets/board/kaykit/` holds 37 pieces from KayKit Dungeon Remastered —
floors, walls, a doorway, pillars, stairs, and the furniture a room needs to look
lived in (beds, tables, chairs, shelves, barrels, crates, kegs, chests, banners,
torches, rubble) — plus its `LICENSE.txt`. 1.9 MB of the pack's 8.6 MB. Adding
more is a file and a line in `board-assets.ts`.

**Deleting the directory is a supported thing to do.** The board falls back to
coloured tiles, which is what the `Plain` theme is and what building your own
pack starts from. Nothing switches off; the models simply are not found.

## Two conventions worth fixing now

**Scale, and which way is up.** The board's world unit is the half-foot, so a
5-foot square is 10 units. `ModelLibrary` measures each model and fits its
footprint to the square rather than trusting a nominal scale, because packs vary
piece to piece.

**A pack will disagree with D&D about how big a tile is, and both sides have to
give.** Measured out of the glTF: every KayKit floor and wall piece is 4.00 model
units across and its walls are 4.00 *tall* — a tile as tall as it is wide, which
is a 10-foot dungeon, not a 5-foot one. Floors and walls have no choice but to
fit the square, because the grid is 5 feet; props are drawn at the pack's own
scale instead, so a table is 10 feet long and a chair 1.9 rather than a doll's
table in a giant's room. Two scales, one file, written down because the numbers
look arbitrary otherwise.

**Where the art and the rules disagree, the rules win.** A KayKit wall fitted to
a 5-foot square is 5 feet tall — a wall you could see over and shoot across, and
the engine has already decided you cannot. `PieceModel.heightHalfFeet` and the
`heightHalfFeet` argument to `ModelLibrary.piece` stretch a piece on its up axis
to the height the board declares. Walls and doorways use it to reach 8 feet;
stairs use it to rise exactly the 5 feet of the step they serve, instead of the
10.2 their proportions would give.

**Measure, do not eyeball.** Every number above came from parsing the GLB
accessors, and so did the direction a staircase climbs — a stair placed by guess
faced the wrong way, which is a bug visible from one camera angle and not the
one you happen to be looking from.

**glTF is Y-up and this world is Z-up.** The loader rotates every model a quarter
turn about X, once, so packs do not each need to know. Without it a floor tile
stands on its edge — KayKit's is 4×4 across and 0.15 thick, and unrotated that
thickness becomes the footprint. It draws as pale strips with gaps, which looks
like a scaling bug and is not one.

**Bookkeeping.** Keep a `licenses.md` beside the assets naming, per pack: where
it came from, its licence, and the date it was checked. "Where did this tile come
from" is unanswerable six months later, and it is the question that gets asked
precisely when it is most expensive to answer.
