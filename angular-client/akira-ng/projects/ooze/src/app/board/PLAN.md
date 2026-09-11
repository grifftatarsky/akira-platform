# The board: what is true, what to build, what not to

Written after the rebuild that replaced generated plants with photographed ones,
and after a round of measurement that overturned most of the plan before it. It
supersedes the tier list in [FOLIAGE.md](./FOLIAGE.md), which is kept because
its dive log and its failures are the useful half.

Every number here is wall clock between presents, at 100% density, 5.7
megapixels. **8.3 ms of that is the display's 120 Hz refresh**, so a measurement
at 8.3 is at the cap and not at its cost.

---

## The rules this board is built under

**The whole map is the shot.** This is a combat simulator. The camera is pulled
back with all 220 by 150 feet in frame nearly all the time, and the rest of the
time it is angled down at part of it. Measured, that wide view is the *expensive*
one — 12.8 ms against 10.0 standing in the field — so an optimisation whose
benefit lands in a close-up is worth close to nothing here, and one that trades
the wide view for the close one is backwards.

**No level of detail that removes foliage from the map.** There was a geometry
ladder and a camera-following window. Both degrade the middle of the shot on a
board looked at from above. Anything that thins, coarsens or culls what is *in
frame* is out, permanently. Detail that changes something nobody can resolve is
fine; detail that removes a plant is not.

**Measure before diagnosing, and check the instrument first.** Every confident
causal guess about this renderer has been wrong, and for most of its life the
instrument was wrong too: `gpuTimeInFrameForMainPass` times the swap-chain pass,
which with a post pipeline installed is a full-screen blit. Wall clock between
presents is the only honest number.

**A person reviews the picture.** Screenshots go to the user. A frame time that
improved and a field that looks worse is a regression, and a still frame cannot
report motion — the crawling lattice and the rotating cards were both invisible
in screenshots and obvious in two seconds of use.

**Nothing is called done by the person who built it.**

---

## Where the frame goes

| camera | frame | meadow | headroom |
|---|---|---|---|
| whole board, top-down | 12.8 ms | ~4.4 | at the cap without it |
| angled, whole board | 11.0 ms | ~2.7 | |
| standing in the field | 10.0 ms | ~1.7 | |

Take the meadow away at any camera and the frame sits at 8.3 — the refresh. So
**the meadow is the entire controllable cost of this board**, and there is about
4.4 ms of it left at the camera that matters.

Meadow cost is dead linear in pixels: **1.25 ms per megapixel**, measured across
four resolutions. It is fragments, and it is not what a fragment costs to
shade — switching off the material's most expensive term saves half a
millisecond. It is how many fragments there are, several cards deep over every
pixel.

---

## Refused, with the measurement

These are not open questions. Each was tried and each has a number.

| | cost | why it cannot work here |
|---|---|---|
| **Frustum culling** | — | Compaction already removed 52% of instances and the frame did not move. The camera where culling removes the most is already the fastest. Off-screen plants are clipped and free. |
| **Draw-indirect compaction** | neutral | Works, 52% fewer instances drawn, no measurable gain. Kept only as the mechanism something else might need. |
| **Screen-space occlusion** | **+10 ms** | Not the occlusion — `totalStrength = 0` costs the same. It is the geometry prepass: 200k meadow instances rendered again for depth and normals. |
| **Meadow receiving shadows** | **+3.3 ms** | And acne. A proxy surface at the same height as the blades on it is what no depth bias can win. |
| **Per-frame re-sow** | **+3.3 ms** | Rules out folding any per-frame test into the placement pass. |
| **Per-frame compute** | **~0.24 ms a dispatch** | Five species is 1.2 ms before doing any work. Batch or do not dispatch. |
| **Fitting cards to the silhouette** | neutral | Kept — it is free and honest — but discarded fragments are cheap, because the cutout runs before the lighting. |
| **Level of detail, thinning** | — | See the rules. |

**The pattern:** anything that adds a second pass over the meadow loses, and
anything that removes instances gains nothing. What this board pays for is
shading fragments in one pass.

## Retired as *temporarily* failed, not permanently

Worth revisiting, and why they failed before:

- **Bloom and the default pipeline.** Never tried. A low sun over a field wants
  it, and it is post-process cost on a board with 4 ms spare.
- **Volumetric light scattering.** `volumetricLightScatteringPostProcess` ships
  with Babylon. It renders occluders into a small buffer rather than a full
  prepass, so the objection above may not apply — it needs measuring, not
  assuming.
- **A cheaper meadow material.** The one idea that attacks the measured cost
  directly. The meadow runs full PBR; it needs the sun, one bounce, a
  hemisphere, a cutout and translucency, and nothing else. Unlit costs 2.78 ms
  against 7.26 — so a purpose-built material has roughly 3 ms in it, and the
  risk is entirely to how it looks.
- **Alpha-to-coverage** (`engine.alphaToCoverage` is a deep import, like the
  multi-render one that blocked SSAO for weeks). Would let the cards blend at
  their edges without sorting. Unmeasured.

---

## The plan

### Now — the board is a map, and a map needs things on it

1. **Trees, rocks, scrub.** `trees.ts` exists from the three.js build and is
   unported; a combat board wants cover more than it wants polish. Poly Haven's
   vegetation is unusable at any resolution — `pine_tree_01` is a 948 MB
   geometry buffer — so trees are built, the way they were before, or they are
   cards like the grass.
2. **Decals.** `abstractMesh.decalMap` ships. Footprints, wheel ruts, scorch,
   blood. This is a simulator; the map should record what happened on it.
3. **GreasedLine** for movement paths, ranges and measurement. It is in the box
   and it is exactly what a tabletop overlay is.
4. **Water.** `@babylonjs/materials/water` for a stream or a pond, which changes
   what a map *is* rather than how it looks.

### Then — the look, in measured order

5. **A cheaper meadow material.** ~3 ms, and the only remaining item with a real
   number behind it.
6. **Bloom**, measured. Then volumetric scattering, measured.
7. **A detail normal on the terrain.** The macro normal bake covers low
   frequency — ruts and clods — at 4 texels per half-foot. Up close the ground
   is still smooth. Babylon's `detailMap` blends a tiled normal over the bump
   map for this exact reason, and the channel layout it wants (R,G normal, B
   diffuse, A roughness) means authoring one packed texture in the packer.
8. **Seasons.** The species table is one July mixture with one drift field per
   species. A date already drives the sun; it should drive the sward.

### Not now

- **A horizon.** Out of scope: a map builder has no way to choose the right one
  without autogeneration, and that is a different project.
- **Anything in the refused table.**

---

## Instruments

Everything above was found with these, and two of them exist because a
measurement lied.

- `tools/board-check.sh` — kills the dev server, lints WGSL, builds, serves
  statically, probes three cameras. Never runs while `ng serve` is live, because
  building into `dist` while the dev server watches it poisons the bundle.
- `tools/chrome-probe.mjs` — runs arbitrary script against the real board in
  real Chrome over CDP and reports root-cause console faults deduped. **Wall
  clock between presents is measured here**, not from any engine counter.
- `tools/board-shot.mjs` — copies the live canvas with `drawImage`. The
  render-target version it replaced worked and lied by omission: it showed the
  frame *before* the post chain, which is how temporal AA shipped unverified.
- `tools/wgsl-lint.mjs` — catches the four silent WGSL faults this project
  repeats, the worst being a backtick inside a shader comment, which closes the
  template literal and produces a shader that compiles to nothing with no error.
- `tools/foliage-pack.mjs` — composes the CC0 cut-out sheet, bleeds colour under
  the alpha, and records each silhouette's outline.
