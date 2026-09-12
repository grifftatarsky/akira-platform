# The board: what is true, what to build, what not to

> **New here? Read [BOARD-HANDOFF.md](./BOARD-HANDOFF.md) first.** It has the
> measured frame breakdown, the open regressions with file:line, the cited
> research and the ordered plan. It also corrects every frame number in this
> file: they came from `gpuTimeInFrameForMainPass`, which times one blit, and
> the board is 18.3 ms at the whole-board camera rather than the ~9 quoted
> below. **And: never use subagents on this repo.**

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
| **Volumetric light scattering** | **+7.2 ms** | Looked like the exception — it renders occluders into a fifth-resolution buffer, not the whole scene. It is not: installed and drawing nothing at noon, the frame went 15.7 to 22.9. It also floods white rather than throwing shafts, because the sky box is not an object for rays to come from. |
| **A cheaper meadow material** | ceiling **2.0 ms** | Unlit is only 2.0 ms below the real thing now that image-based lighting and fog are gone; those were the gap the old 3 ms estimate measured. None of PBR's own cheap switches move it either. |

**The pattern:** anything that adds a second pass over the meadow loses, and
anything that removes instances gains nothing. What this board pays for is
shading fragments in one pass.

## Retired as *temporarily* failed, not permanently

Worth revisiting, and why they failed before:

- **Bloom and the default pipeline.** Never tried. A low sun over a field wants
  it, and it is post-process cost on a board with 4 ms spare.
- ~~**A cheaper meadow material.**~~ **Re-measured and no longer worth it.** The
  3 ms this claimed came from unlit costing 2.78 against 7.26 — and that gap was
  image-based lighting and fog, both of which have since been removed. Measured
  again with them gone: the meadow costs 4.7 ms and *unlit* costs 2.0 less, so
  2.0 ms is the absolute ceiling and a material that still lights anything would
  see less. None of PBR's own cheaper switches move it either — energy
  conservation, the correlated visibility term, physical light falloff,
  translucency and the specular highlight together measured inside the noise.
- ~~**Alpha-to-coverage.**~~ **Verified dead, not merely unmeasured.**
  `webgpuCacheRenderPipeline.js` computes
  `alphaToCoverage = this._alphaToCoverageEnabled && sampleCount > 1`, and the
  engine is built with `antialias: false` because the temporal resolve does the
  anti-aliasing — so the flag is a silent no-op. Turning MSAA back on to reach
  it would put stochastic sub-pixel coverage in front of a temporal resolve,
  which is the one thing that resolve cannot reconstruct. See
  [FOLIAGE-REPORT.md](./FOLIAGE-REPORT.md).

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
6. ~~**Bloom**~~ — done, 1.2 ms at a quarter resolution, on its own switch.
   Volumetric scattering measured and refused; see the table.
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

## Four things that were silently off, and how each was found

Every one of them shipped green, and every one was found by asking the renderer
a question rather than by reading the code.

**The grade was disabled everywhere, for as long as bloom has existed.**
`DefaultRenderingPipeline.imageProcessingEnabled = false` is not a local flag:
its setter writes `scene.imageProcessingConfiguration.isEnabled`, the master
switch every PBR material reads. Tone mapping, contrast, exposure and vignette
were off board-wide, and the grade toggle was flipping settings on a
configuration nothing applied. Found by printing `isEnabled` — it read `false`
with nothing in this codebase having set it.

**Bloom's white wedge was the sky, and the sky was the only ungraded surface in
the frame.** `SkyMaterial` does no image processing at all, so with the grade
living inside each material the atmosphere went into the frame at several times
white and nothing compressed it. Blurred and added back, that can only clip.
Turning the grade into a post pass — which is where it belongs anyway, because
it then covers the sky — removed the wedge with no change to bloom's own
settings.

**A merged mesh was in `scene.meshes` twice, so every tree was drawn twice.**
`Mesh.MergeMeshes` creates its result in the scene already; the `scene.addMesh`
after it appends a second entry, and a mesh listed twice is dispatched twice.
Found by counting names in `scene.meshes`. Worth 2.6 ms at the wide camera.

**`part` indexed primitives where it meant plants.** Babylon splits a
multi-primitive glTF node into children named `<node>_primitiveN`, so the flat
mesh list runs bark, leaves, twigs of the first plant, then of the second.
Indexing it picks a *material*: `searsia_lucida` shipped as five copies of one
bush's twigs and ten of another's bark. Found by reading the glTF's own
material names beside the vertex counts the scene reported.

## Scans are the size they were photographed at

`island_tree_02` is 3.4 m tall and the largest `searsia_lucida` in its
seven-plant scan is 2.3 m. Both were being asked for at eight and twelve times
that, and a canopy's leaf density falls with the cube of the scale — which is
the whole explanation for scrub that came out pale, thin and showing its stems.
A scan carries its own density and the only way to keep it is to leave its scale
roughly alone. Check `h=` per node before choosing a `tall`.

The same applies to what a scan is *for*. A shrub scan makes shrubs. Field trees
want a tree scan, and this board has exactly one.

## Standing things need the drawn surface, not the height field

Two separate ways a tree floats:

- **Rebasing on the bounding box** stands a plant on whatever hangs lowest,
  which on a tree is the tip of a drooping branch well below the trunk. Anchor
  on the bark primitive's own lowest point instead; it is where the plant meets
  soil, and its horizontal centre is the trunk rather than the centre of a
  lopsided crown.
- **`heightAt` is not the surface anybody can see.** The terrain mesh carries one
  vertex per half-foot and interpolates between them, so over ruts the drawn
  triangle runs above the height field in the hollows. Sample the lattice the
  mesh actually uses, across the footprint, and take the lowest.

## The scans were painting their own background

Poly Haven's plant and tree scans are flat cut-out cards whose base colour is an
atlas of foliage on solid black, and the JPEG download carries the atlas and not
the mask. JPEG cannot hold alpha, glTF says a base-colour texture without alpha
is opaque, so the alpha test compared 1.0 against its cutoff and discarded
nothing. Measured over the UV area each primitive covers: 54-66% of a celandine
is black, 41% of a dandelion, 49% of `island_tree_02`'s leaves and **93% of
`searsia_lucida`'s** — the scrub this board called excellent was almost entirely
painted background.

The mask ships as a separate `Alpha` download the glTF never references. Bind it
as `opacityTexture` with `getAlphaFromRGB`, keep `MATERIAL_ALPHATEST`, and pass
`invertY: false` as the fourth `Texture` argument or it arrives flipped.

**The one-line falsification, to run before anything else:** set
`alphaCutOff = 0.99`. If nothing disappears, alpha is 1.0 everywhere and no
transparency setting can help. Three plausible fixes — blend mode, shadow
casters, receive-shadows — were tried before this was, and none of them was it.

Full reasoning, citations and the remaining work in
[FOLIAGE-REPORT.md](./FOLIAGE-REPORT.md).

## Two ways this project measures itself wrong

Both cost hours and both are in the tooling now, not in anyone's memory.

**`board-shot.mjs` does not navigate.** It runs a script against whatever page
Chrome already has open, so a screenshot taken straight after a rebuild is a
picture of the *previous* build. Several rounds of tree tuning were judged
against renders of code that was no longer running, which is how a rule that
deleted six of seven trees read as "no change". **Always run `chrome-probe.mjs`
first — it navigates — and shoot afterwards.**

**The dev server serves the last good bundle when a build fails**, and can
serve a stale *chunk* even when the build succeeded. No error on the page and
none in the probe: the board is simply not the board in the working tree. Two
already-correct fixes looked like failures because of this.
`tools/build-ok.sh` catches the first; the only guard against the second is to
verify on a clean `ng build ooze` served statically rather than on `ng serve`.
The tell is a value you just changed still reading its old number.

**`devbuildall.sh` leaves `dist/ooze` without an `index.html`.** It builds the
federated remote, not the standalone app, so the static probe server 404s every
page afterwards and every measurement comes back empty. Rebuild with
`ng build ooze` before probing.

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
  **A WebGPU canvas reads blank outside a frame callback**, and it reads blank
  from `onAfterRenderObservable` too — `requestAnimationFrame` is the only hook
  that has the swap chain in it. A toggle-by-toggle pixel diff has now twice
  come back all zeros for this reason and been believed the first time.
- `tools/board-angles.mjs` — sweeps nine fixed cameras, shoots each and times
  each by wall clock. One screenshot is not a review: every foliage mistake here
  was invisible from the angle it happened to be photographed at.
- `tools/foliage-trim.mjs` — measures where each cut-out's photographed stalk
  ends, from the sheet's alpha coverage, and records it. Silhouette width cannot
  answer this and two attempts at it were wrong.
- `tools/build-ok.sh` — refuses to let a measurement be taken against a bundle
  the dev server failed to rebuild.
- `tools/wgsl-lint.mjs` — catches the four silent WGSL faults this project
  repeats, the worst being a backtick inside a shader comment, which closes the
  template literal and produces a shader that compiles to nothing with no error.
- `tools/foliage-pack.mjs` — composes the CC0 cut-out sheet, bleeds colour under
  the alpha, and records each silhouette's outline.
