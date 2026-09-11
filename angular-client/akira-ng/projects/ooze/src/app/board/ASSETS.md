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

`public/assets/board/hdri/` holds two 1k HDR environment maps from Poly Haven,
CC0, by Andreas Mischok — `sepulchral_chapel_basement` (in use) and
`drachenfels_cellar` — 3.3 MB together. They are used **only** as image-based
lighting: the renderer convolves each into an irradiance map and never draws it
as a backdrop, which is why 1k is enough. Nothing here is mirror-smooth, so
nothing can show detail the convolution has already discarded, and the same
capture at 8k is 98 MB.

**Deleting either directory is a supported thing to do.** Without models the
board falls back to coloured tiles, which is what the `Plain` theme is and what
building your own pack starts from. Without an environment map it falls back to
three's generated `RoomEnvironment` — a worse dungeon and a perfectly good
light. Nothing switches off; the files simply are not found.

## Lighting

**An environment map is not decoration, it is most of the lighting.** Every
KayKit piece is a `MeshStandardMaterial` at metalness 0, roughness 0.45 —
measured, not assumed — and a physically-based material with no environment gets
no ambient specular at all and no directional ambient. One flat ambient term
plus one sun is the light you would use to photograph plasticine, and it looked
like it. `scene.environment` was the single biggest change on this board; the
ambient light went from 0.75 to 0.08 in the same commit because the environment
had taken over its job and was doing it with a direction.

**Local light is a texture, not lights.** A dungeon wants a lamp on every torch,
and a renderer wants nothing of the sort — every real light costs shader work on
every surface, and a shadow-casting point light costs six renders of the scene.
`light-field.ts` bakes the board's light levels and every flame on it into a
small image (four texels to a five-foot square) which every material samples
once. Two hundred lights cost what two do. The reach of each is the SRD's own
number: a torch is Bright for 20 feet and Dim for 20 more, drawn.

**The multiply goes before tone mapping, not after.** Three's last shader chunk
is the obvious hook and the wrong one — by then the colour has been through the
tone curve and encoded to sRGB, so scaling there darkens a display value rather
than reducing an amount of light, and a torch can never be brighter than white.
Injected ahead of `tonemapping_fragment` it is still linear radiance, so a pool
over 1.0 rolls off into a warm highlight.

**Khronos PBR Neutral, not ACES.** Both roll highlights off; ACES also
desaturates hard as it does it, because it emulates film and film does that.
This board is painted rather than photographed, and torchlight that goes cream
in the middle of the pool is exactly the look we are aiming away from.

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

## Why there are almost no downloaded models

Everything on the outdoor boards that is not ground is *built*: the conifers,
the scrub, the ruined lighthouse, the log cabin. That was not the plan — the
plan was Poly Haven, which has beautiful trees.

**Poly Haven's `pine_tree_01` is a 948-megabyte geometry buffer.** `fir_tree_01`
is 465. They are film assets: every needle is real geometry, and there is no
amount of decimation that turns one into something a browser should fetch. The
rocks are fine — a boulder is 3 to 6 MB, a coastal rock set 20 to 25 — but the
vegetation is not usable at any resolution the library offers.

So the trees are `Species` in the meadow system, the same as the grass: tapered
strips, no textures, no alpha. A tree is about 350 triangles, a wood of a
hundred and fifty of them is a rounding error next to the ferns underneath, and
it inherits the instancing, the chunking, the pixel budget, the wind and the
light-through-a-leaf for nothing. It is also closer to what this board is aiming
at — the target is a painted game, and a painted wood wants a confident
silhouette rather than a photograph of bark.

**If you do want a Poly Haven model**, the API gives a glTF plus its textures as
separate files, so it takes a script rather than a download:

```
GET https://api.polyhaven.com/files/<name>
  → .gltf[<res>].gltf.url          the document
  → .gltf[<res>].gltf.include{}    every texture, keyed by its relative path
```

Fetch the document and each include into `public/assets/board/models/<name>/`,
preserving those relative paths, and the loader will resolve them. Poly Haven
refuses requests with no `User-Agent`. **Check the `.bin` size before committing
anything** — that is the one number the asset page does not show you, and it is
the one that matters.

## Foliage

The meadow's plants are photographed cut-outs on cards, not modelled geometry.
`public/assets/board/foliage/foliage.png` is one sheet of 24 of them, composed
by `tools/foliage-pack.mjs` from these, all **CC0**:

| Source | Licence | What it gives |
|---|---|---|
| [ambientCG Foliage006](https://ambientcg.com/view?id=Foliage006) | **CC0** | 7 single grass blades and 2 multi-blade sprays, scanned. |
| [ambientCG LeafSet020](https://ambientcg.com/view?id=LeafSet020) | **CC0** | 5 dandelion leaves — the plantain's rosette and the daisy's basal leaves. |
| [ambientCG FlowerSet001](https://ambientcg.com/view?id=FlowerSet001) | **CC0** | 6 oxeye daisy heads. |
| [OpenGameArt — White Clover Cutouts](https://opengameart.org/content/clover-cutouts-improved-and-expanded) | **CC0** | 3 whole trefoils on their stems, plus a flower head. Remixed from CC0 OpenGameArt and Wikimedia sources. |

**`Foliage003` is the one you will want and it does not work.** Its four grass
stems with seed heads are exactly the Yorkshire fog, and they lie across the
sheet at forty degrees — so their axis-aligned bounding boxes overlap heavily and
a card cropped to one carries pieces of its neighbours. Cropping cut-outs that
are not upright needs a rotated fit, which is a different tool.

**Colour has to be bled outward before opacity is attached.** ambientCG splits
colour and opacity into separate files, and outside the cut-out the colour map
is white — nothing authored it, because nothing was meant to read it. A bilinear
sample near the silhouette mixes that white in, and every leaf gets a pale halo
that is invisible in the source files and obvious on a card. The packer dilates
the colour ten rounds into the transparent region first. A PNG that already
carries alpha needs the same treatment for the same reason, with black instead
of white.

**Cards are cut out, not blended.** A quarter of a million overlapping
transparent quads has no correct draw order; a cutout is a discard, needs none,
and writes depth like anything else. The cost moves from triangles to fragments —
alpha testing disables early-Z, so a card's whole quad is shaded and then thrown
away. That makes card *area* the thing to watch, and not card count.

**Poly Haven's vegetation is still unusable** for the reason recorded above:
`pine_tree_01` is a 948 MB geometry buffer. Scans on cards are how a browser
gets photographic plants at all.
