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

Measured 2026-09-12 at 3600 x 2086, midsummer, the sward at 100%, by taking each
piece away and reading wall clock between presents. The parts sum to within a
millisecond of the whole, so there is no unattributed remainder left.

| piece | ms | share |
|---|---|---|
| **whole frame, play camera** (beta 1.02, r 300) | **22.9** | 100% |
| sward | 8.1 | 35% |
| trees and scrub | 4.8 | 21% |
| shadows | 3.8 | 17% |
| terrain | 1.9 | 8% |
| ground flora | 1.7 | 7% |
| temporal aa | 1.2 | 5% |
| stone | 0.4 | 2% |
| ground relief, sky light, grade | 0 each | |
| unattributed | 1.0 | 4% |

Across the nine-angle sweep the whole board runs 21.1 ms (overhead) to 23.5 ms
(low), and 16.3 ms standing in the field. The target is 16.6 ms.

**Every frame number in this file before 2026-09-12 was wrong**, including the
table this replaced. Two instruments were reading
`gpuTimeInFrameForMainPass`, which with a post chain installed times one
full-screen blit — the Babylon d.ts says so outright: "will only return time
spent in the main pass, not additional render target / compute passes (if any)"
(`Engines/thinWebGPUEngine.d.ts`). `split-frame.ts` was one of them, so the
per-component numbers it produced were the blit moving around.

Resolution is close to linear and is the largest untested lever: halving each
axis (hardware scaling 1 instead of the 2x device ratio) took 19.7 ms to 11.6 ms
with nothing else changed.

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

## Traps that used to live in comments

The code carries no comments. That is deliberate — a comment is read as truth
and the code is not re-read against it, and four wrong beliefs on this board
came from exactly that. What a comment cannot be recovered from the code is
*what was tried and did not work*, so that lives here.

**`terrain.ts` — the shadow proxy must keep the terrain's material.** Nothing
samples the proxy and nothing lights it, so nulling its material looked like
honesty. It is not: `RenderingGroup.dispatch` returns immediately on a null
material, so does the shadow generator, and a default is only substituted when
`StandardMaterial` has been imported, which this board never does. Nulled, the
forty proxy chunks were built, uploaded, culled and never drawn, and the field
cast nothing on the road for as long as the proxy had existed.

**`terrain.ts` — the triangle winding is for Babylon's left-handed frame.** The
board is right-handed with Z up and `toStage` swaps two axes to reach Y up,
which reverses orientation. Wound the other way, `ComputeNormals` returns
normals pointing straight *down*: the ground is lit from underneath and renders
black under a midday sun, while still looking green at distance because
image-based light has no direction to get wrong.

**`terrain.ts` — no vertex tangents, and they were tried.** Supplying an
analytic tangent as a vertex buffer produced a stream of WebGPU validation
errors and a board that drew nothing. Not chased further: the terrain is one
fragment deep over every pixel and the meadow over it is several, so this was
the smallest saving on offer and the only one that broke the picture.

**`terrain.ts` — the shadow-only layer works because render targets ignore
`layerMask`.** A render target given an explicit render list does not check it,
and the shadow map is given one, so a mesh on a layer no camera looks at is
still drawn into every cascade. That is the whole mechanism: no second material
and no visibility flag the shadow pass would also honour.

**`meadow.ts` — `forcedInstanceCount` is the ceiling, not the count.** Babylon
writes the instance count into the draw's argument buffer from it and skips the
write whenever the number has not changed, so a constant ceiling means it writes
once and the count the compute pass publishes is what stands. Handing it the
real count has the CPU and the compute pass fighting over the same four bytes
every frame.

**`meadow.ts` — the sward does not receive shadows, and it was tried twice.**
The second attempt was after the lifted proxy existed, so the original objection
was gone. It costs 3.3 ms of a 12.9 ms frame and it brings acne: a proxy surface
at the same height as the blades standing on it is exactly the configuration a
depth bias cannot win, and at a low sun the field fills with faint diagonal
banding.

**`meadow.ts` — the sward opts out of image-based light by overriding
`_getReflectionTexture`**, which is why `environmentIntensity` can be raised for
the ground and the scans without the field going pale.

**`splat-bake.ts` — a blended normal has to be decoded, blended as a direction,
and re-encoded.** Averaging three scans' encoded bytes gives something shorter
than unit length, which reads as a flattened surface exactly where two layers
meet — the verge, which is the one place on this board anybody looks closely.

**`bab-board.ts` — the board starts from `ngAfterViewInit`, not an `effect`.** A
signal effect on a `viewChild` is a race: it can run before the view exists, and
`viewChild.required` then throws inside the effect where the component's own
try/catch cannot see it. The board started once and then stopped starting.

**`bab-board.ts` — Babylon throws bare strings in places**, so `error.message`
is often undefined and a `?? 'unknown'` fallback hides the only useful thing
there is.

**`bab-board.ts` — the flat-light probe needs a white *ground* colour.** The
hemisphere's ground colour is a dark brown, so a downward normal reads as black
under ambient alone; an earlier version turned the sun off but left the brown,
which is why it proved nothing.

### In `stage.ts`

**Two imports are there for their side effects.**
`forceSphericalPolynomialsRecompute` is patched onto `BaseTexture` by a separate
module; without it a probe that renders a new sky hands the PBR materials the
*first* sky's irradiance forever — the specular moves with the sun and the
diffuse does not.

**SSAO2 was tried and taken out.** `SSAO2RenderingPipeline` wants depth and
normals in a multiple render target, which with deep imports is not on the engine
at all: "createMultipleRenderTarget is not a function", thrown from inside the
render loop on the first frame. Importing the extension got past that and into a
stream of WebGPU validation errors with the meadow no longer drawing — a geometry
prepass over a quarter of a million instanced plants meeting a path never asked
to carry them.

**God rays were tried.** They render *occluders* into a fifth-resolution buffer
rather than the whole scene, which looked like the exception to "no second
geometry pass". It is not: installed and doing nothing — noon, sun off screen —
the frame went from 15.7 ms to 22.9. The pass runs whatever the sun is doing. It
also floods white rather than throwing shafts, because with the sky box as the
light's stand-in the occluder is the thing the rays should come *from*, and a sky
is not an object.

**`camera.attachControl(true)` scrolls the page.** The second argument is
*noPreventDefault*, so `true` leaves the wheel event to the document and the page
scrolls away underneath while the camera zooms. The canvas needs
`touch-action: none` for the same reason on a trackpad.

**Babylon 9.26 replaced `panningMouseButton` and `useCtrlForPanning`** with a
declarative table on `camera.movement.input`. Setting the old properties is a
silent no-op on an object that no longer reads them — and the first attempt
appeared to work, because right-drag panning is in the *default* table.

**The shadow map stays at 2048 and halving it bought nothing.** The pass is bound
by draw calls, not fill: forty terrain chunks across the cascades. The lever is
fewer casters or fewer cascades — measured at 3.25 ms for four cascades, 2.17 for
three, 1.32 for two.

**`shadowMaxZ` has to reach the far edge of the board.** At 400 there was no
shadow term past four hundred units, so the far half of the board was lit
differently from the near half with a hard horizontal edge sliding up and down as
the camera zoomed — an artifact a still screenshot from one distance cannot show.
It is set from {@link frame} instead.

**The sky probe must be float.** A sky has a sun in it and the sun is far brighter
than white; clamped to eight bits the whole dome flattens to one pale blue and the
light it casts loses its direction.

**Fog was removed and it was not free.** It measured 1.5 ms of a 7.1 ms meadow —
a per-fragment term paid once a *layer* on a sward several cards deep over every
pixel.

**TAA has to be first in the camera's chain**, or it resolves an image that has
already been graded. Its `factor` is 0.16 rather than 0.06 because Babylon's
temporal resolve reprojects with the camera matrix alone and has no velocity
buffer: every blade moves in its own vertex shader, so every blade reprojects to
the wrong place and a long history smears.

**`antialias: true` on the engine is not `pipeline.samples`.** It sets
`_mainPassSampleCount` to four, allocating a four-sample colour target and a
four-sample depth target at the full canvas — about ninety megabytes each — and
resolving them every frame, for a main pass that with the temporal pipeline
installed contains one full-screen blit and no edges. That is where the 24 ms
came from, and it is not a measurement of MSAA-in-the-pipeline.

**`bloom.imageProcessingEnabled = false` turns the grade off for the whole
board.** The setter writes `scene.imageProcessingConfiguration.isEnabled`, which
is the master switch every PBR material reads as well. Set false the day bloom
shipped, it disabled tone mapping, contrast, exposure and vignette everywhere —
so the grade toggle flipped settings on a configuration that was not being
applied, and reported nothing.

**`SkyMaterial` does no image processing at all.** Graded inside the materials,
the sky was the one surface never tone mapped, which is why bloom read as a white
wedge across the horizon: a sky several times brighter than white, blurred and
added back to an image with no highlight compression in front of it, can only
clip.

**Bloom has nothing to find on a midday meadow.** Threshold sweep, read as mean
pixel change against a noise floor of 2.3: threshold 0 moves 117, 0.2 moves 36,
and **every threshold from 0.4 upward sits at the noise floor**. Nothing there
exceeds a luminance of about 0.4. Its scale is a quarter because at a half it
measured 1.8 ms, which is more than the sun costs.

**Tone mapping is Khronos neutral, not ACES.** ACES is built for wide-gamut input
and its documented failure is hue skew in the highlights and desaturation, the
reported symptom being washed-out highlights and crushed blacks *especially in
foliage* — the entire content of this board.

**`enableGPUTimingMeasurements` must be set after the device exists and before
any frame.** The query pool is sized at that point; turning it on later throws
"WebGPUDurationMeasure: index out of range" from inside a render pass.

**A failed engine init must `dispose()`.** A page that reloads onto a failed init
half a dozen times leaves that many adapters outstanding, and the next
`requestAdapter` then hangs with no error anywhere — which reads exactly like the
code being broken, and is not.

### In `foliage-cards.ts`

**A card is fitted to the silhouette, and that is the whole of its cost story.**
Alpha testing disables early-Z, so every fragment inside a card's quad is shaded
and only then thrown away by the cutout — and a scanned grass spray fills about a
fifth of its box, so four fifths of its fragments were pure waste. Measured, that
waste was the entire remaining cost of the meadow. The card is already rows of
two vertices, so moving those two to where the leaf actually begins and ends at
that height fits the strip to the plant for no extra vertices at all; that is
what `Cut.spans` is.

**Two columns and no more.** A third column down the middle is what the modelled
leaves had, for a crease — and a scan already has the crease in its shading, so
the column would double the triangles to describe something the texture states.
The *rows* are worth having, because the wind and the droop bend the card along
its length and a bend needs somewhere to happen.

**The per-card jitter is a fixed function of the index, not a random number**, so
the mesh is identical every build. It is geometry, not a simulation.

**A flower head is not a leaf and a quad is the wrong mesh for it.** Built as a
card it hangs off the stem by its bottom edge and is a hard line seen along its
plane; the rescue of a second card crossed through it read as two flowers in an
X, because it was two flowers in an X. It is a fan now — one vertex at the stem,
a ring around it, the photograph mapped radially — and dished rather than flat,
so it has a silhouette from the side instead of a vanishing line.

**`trimStalk` exists because a scan carries its own petiole.** A clover cut is a
trefoil *on its stalk*, so a card carrying the whole of it can only ever sit at
whatever angle its stalk was photographed at — leaning the card was a rotation
standing in for a mesh. What separates stalk from leaf is coverage: a row of
stalk is about two per cent alpha and a row of leaf eighty, which
`tools/foliage-trim.mjs` measures once into the sheet's table.

**`lift()` holds its floor by leaning the normal, not by clamping a component.**
Clamping y after the divide leaves a vector that is no longer unit. The floor is
not zero because a normal exactly on the horizon still takes nothing from the sky
and everything from the hemisphere's brown ground colour, which reads as black on
a thin leaf.

### In the shaders

**`splat-bake.ts` — every uniform is a `vec4f`, and that is not tidiness.** A
`vec3` aligns to sixteen bytes in a WGSL uniform block, but Babylon packs its
uniform buffer by declaration order, so a `vec2` followed by a `vec3` lands the
`vec3`'s fields in the wrong slots. Here that made feet-per-repeat read as zero,
the UVs divide to infinity and every sample come back black — from a shader that
compiled without a word of complaint.

**`splat-bake.ts` — the stochastic tiling needs explicit gradients.** The hashed
offsets are discontinuous across a cell edge, and letting the hardware derive
the mip from them picks the smallest one along every seam.

**`splat-bake.ts` — blend toward the mean in linear space and push the contrast
back.** A straight weighted average of three photographs is flatter than any of
them, which is the known failure of the technique.

**`meadow.ts` — do not name a WGSL local `step` or `cell`.** `step` is a builtin
this shader calls further down, and shadowing it turns that call into "cannot
use 'let step' as call target". `cell` is taken by the clump code.

**`meadow.ts` — WGSL refuses to mix `*` and `^` without parentheses**, and it
refuses by failing to parse the whole stage, silently, with a material that
still reports itself ready and a field with no grass in it.

**`meadow.ts` — the clump is a Voronoi cell, not the lattice cell.** Keying the
clump on the square cell paints the field in squares: the clump decides height
and colour, so every eleven half-feet the whole sward changes tone along a
straight line, and from directly above — this board's camera — it reads as a
chequerboard over the grass. It was the most visible artifact on the board at
full zoom-out. Nine cells is the whole search, because a seed jittered inside
its own cell can never be nearer than one two cells away.

**`meadow.ts` — alternate rows are staggered by half a cell.** A square lattice
with bounded jitter shows its rows running away across the field; the stagger
makes it triangular, which has no rows to look down.

**`meadow.ts` — `alive` scales all three matrix columns, not the height.**
Scaling only the height leaves a culled plant as a flat quad of full width lying
on the ground with a zeroed column, and a matrix with a zero column has no
usable normal, so it shades black. On a grass-only sward those were slivers
nobody saw; a clover leaf is not a sliver, it is a black scrap on the verge,
hundreds of them, exactly where the wear test culls the most.

**`meadow.ts` — the instance basis is built with a cross product because it has
to be orthogonal.** The through column used to be forced horizontal to stop a
leaning plant tipping its normal at the ground. It worked and it was wrong: with
up leaning and through level, `dot(through, up)` is `sin(lean)`, so the basis is
skewed rather than rotated, and a skewed matrix mistransforms a normal exactly
the way a non-uniform scale does — the transformed normal for a leaflet facing
the wrong way drops below the horizon and shades black. That defect survived
every other explanation, because every other explanation was about the material
and this one is arithmetic.

**`meadow.ts` — the survivors are compacted by an atomic counter.** Losers used
to be written as a zeroed matrix and submitted anyway; a degenerate instance
costs no fragments but still costs its setup, and at four hundred thousand of
them that is a bill for plants nobody can see.

**`meadow.ts` — taking the strongest species outright gives solid mats.** It was
tried in the renderer this came from: white sheets laid over the field instead
of daisies standing in it. The drift weights are normalised across species so
they trade instead — where the daisies come in, the grass between them thins.

**`meadow.ts` — the hash is integer, not a sine.** Sine hashes band visibly at
large coordinates because they sample a smooth function, and a meadow is exactly
where a faint regular pattern shows.

**WGSL comments are gone too, which removes a hazard.** `wgsl-lint.mjs` exists
partly to catch a backtick inside a shader comment — it closes the template
literal and produces a shader that compiles to nothing, with no error. There are
no shader comments left to put one in.

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


## The sward's coverage, and the wind (2026-09-13)

**A card is invisible from above.** The complaint was that you see ground
through cards and not through blades, and the cause is geometry, not width: an
upright quad seen from overhead is a line. Five near-vertical cards a plant
leave gaps; a blade is a solid tapered tube and presents area from every
direction. Measured as the share of a steep-camera view that is hole or dirt:
cards 5.6%, blades 1.2%.

Leaning the cards over is the cheap half of the fix and costs nothing — same
triangles, same plants. The full fresh-browser curve, all four sown back to
back in one session at 3600x2026:

| grass cards | holes | play camera |
|---|---|---|
| 5 at lean 0.34 (as it was) | 5.6% | 27.7 ms |
| 5 at lean 0.90 | 4.3% | 28.3 ms |
| 7 at lean 0.90 | 2.5% | 30.2 ms |
| 9 at lean 0.90 (shipped) | 1.8% | 31.9 ms |
| blades | 1.2% | ~50 ms |

Raising `perArea` 1.5x on top reached 1.0% at 39.9 ms, still ten under the
blade — untaken, because the lattice is then near `MAX_PLANTS`.

**Do not tint the terrain green to hide the gaps.** Refused by the user before
it was proposed; the coverage has to be real geometry.

**The wind is running and cannot be seen.** `meadow.ts` sets
`wind.strength = 0.62 * plant.stiff` against the plugin's own default of 1.35,
and the sward sweeps about 7/255 over three seconds — real motion, below the
threshold of reading as wind. At 250% the sweep is 22/255 and obvious. There
is a **Wind** slider now; 1.2 is still the shape of the gust, not its size.

**A probe that mutates the board leaves it mutated.** Several runs here set
`sown.wind.strength = 0` for a still comparison and never put it back, and the
meadows are cached in `grown`, so the board stayed windless for the user until
a reload. Restore anything a probe changes, in a `finally`.

**Do not judge a shading technique on a frozen field.** The twist was first
measured with the wind zeroed, which removes the one condition it exists for —
a blade turning through the light. Re-run with the wind running it is still
inert (spatial contrast 22.70 card against 23.02 twist), so the conclusion
held, but it had not been earned.

## What `blade-wind.ts` knew, before its comments were stripped (2026-09-13)

Salvaged whole, because none of it is derivable from the code that remains.

**Height cannot come from the uv.** `vertexInputs.uv` is only declared when
something in the material wants it, and this material has no texture at all.
Pushing the attribute does not help and neither does the define — a plugin's
defines do not reach the material's. The shader fails to *parse*, as a
validation warning, with no exception anywhere and a field with no grass in it.
Height is `positionUpdated.y / bladeTall.x` instead.

**`bladeAlong` is declared outside its braces on purpose.** The hooks are
separate injection sites in one function, and that is how the shading block at
`CUSTOM_VERTEX_MAIN_END` sees it.

**The stem's bend is an integrated circular arc, not a shear.** It was the
tangent of the lean used to shear sideways, with a hand-fitted term taking
height back off so the sheared blade did not stretch. That term was quadratic
in half-feet, so on the one plant tall enough to matter — Yorkshire fog at four
and a bit — it went past one, turned the height negative, and stood the whole
species upside down beneath the meadow. The arc preserves length by
construction and cannot invert.

**There is no turn toward the camera, and there must not be one.** Ghost of
Tsushima's view-space thickening was here, rolling each card about its stem to
face the viewer, because a flat strip seen edge-on is a line. It read the eye
position, so the whole field rotated slightly on every zoom — obvious to a
person using the board and invisible in every screenshot. The scanned cards are
wide enough that there is no edge-on case left to rescue.

**`ground` was documented as needing to stay above about 0.6**, because a leaf
whose own normal points at the ground can drag the blend under the horizon and
take the hemispheric light's brown. The **Leaf normal** slider (1.1d) goes to
zero and the field does not go brown, because `lit.y = max(lit.y, 0.08)` is a
backstop that postdates that note. Treat 0.6 as advisory, not a floor.

**The root's darkness is the compute pass's enclosure**, carried in the
instance colour's alpha: a plant in a thick clump has neighbours over it and
goes dark at the base, one on a worn verge is lit to the ground.

**The wind used to live in the compute pass**, re-sowing six hundred thousand
blades every frame to change a lean. The compute pass now runs when the density
changes and not otherwise.

**The per-plant dice is hashed from `floor(world3.xz * 8.0)`** — the plant's
rooted position, not an index, because the vertex stage has no index; and from
nothing that changes with the frame, or the field boils.


## The pale flora is the scan, not the renderer (2026-09-13)

The rosette cut-outs — the broad leaves that read as washed out in the sward —
are pale yellow-green **in the atlas**. Pulled out of `foliage.png` and looked
at directly, all five of them.

Two renderer levers were measured against it, on the same camera, counting
pixels that fall in the pale-leaf hue:

| lever | pale-leaf area | mean green |
|---|---|---|
| albedo wash 1.00 (as it was) | 5.91% | 175 |
| wash 0.85 | 5.42% | 172 |
| **wash 0.70 (taken)** | **4.65%** | 168 |
| wash 0.55 | 3.50% | 165 |
| ground blend 0.68 → 0.82 | 5.13% (worse) | 170 |
| ground blend 0.68 → 0.92 | 5.29% (worse) | 171 |

So the albedo works and has a ceiling: the leaf is blown out by direct sun, not
by its albedo, and the ground blend makes it worse because the ground normal
points at the sun too. **The fix that would actually work is a darker source
cut**, in `foliage-pack.mjs`, not anything in the renderer.

**Translucency is off everywhere now** — 2.3 measured it at 0.4 ms *and*
visibly darker. Both the sward material in `meadow.ts` and the scanned-leaf
material in `standing.ts` had it on.


## Baking is slower than instancing here (2.4, 2026-09-13)

The claim in forum 46756 is that merging N copies of a mesh into one buffer is
about four times faster than thin instances. On this board it is **18% slower**.

112,543 grass plants, the same plants both ways, both drawn with a plain PBR
material carrying the atlas and no wind plugin, at a mid camera, with the
empty-scene frame subtracted:

| | above empty |
|---|---|
| thin instances | **6.5 ms** |
| baked into one buffer | 7.65 ms |

Coverage was matched to within 0.1% of the view (54.52% green against 54.42%),
which is the only reason the numbers can be compared at all.

**Two false results came first, and both would have been published.** The
baked mesh drew nothing:

  - `new (src.geometry.constructor)()` is a **Geometry**, not a `VertexData`.
    Assigning `.positions`/`.indices` to it and calling `applyToMesh` is silent
    and does nothing. Build with `mesh.setVerticesData` / `mesh.setIndices`
    instead, which needs no class reference.
  - At 40,000 plants at the play camera the whole test sat inside the noise —
    instanced 8.6 against an 8.3 empty frame — so a broken arm reading exactly
    the empty baseline looked like a 45% win.

**Every A/B of a draw path now reports its own coverage**, and a zero reading
next to a non-zero one is the thing to check first. Baking would also give up
the wind, the ground-normal shading, the per-plant tint and the compute
placement: all four read the instance matrix columns.


## What the shadows are actually spending (2.6, 2026-09-13)

Play camera, 3600x2026, fresh browser, 9am sun. Every reading is the median of
110 frames, taken by swapping the shadow map's `renderList` in place so nothing
else in the scene moves.

| | ms | |
|---|---|---|
| shadows off entirely | 26.4 | |
| shadows on, **renderList empty** | 28.2 | **1.8 ms is the receiving side** |
| all casters | 30.5 | 2.3 ms is drawing the casters |
| all casters but the big tree | 29.3 | that tree is **1.2 ms** |
| all casters but the stones | 30.4 | the seven stones are 0.1 ms |

So the 4.1 ms is **1.8 receiving + 2.3 casting**, and over half the casting is
a single mesh. The caster list is 4.93M triangles; `scan-island_tree_02-0` is
**3.22M** of them — 403,000 triangles, eight instances, rendered into both
cascades every frame for a shadow that covers a few dozen texels of a 2048 map
spanning 1144 half-feet. Its shadow is visibly missed when removed, so the
answer is a decimated proxy, not dropping it.

The receiving 1.8 ms is PCF over 91 receivers and only comes down by changing
the look (fewer cascades, lower filtering quality).

**Do not change `numCascades` at runtime on WebGPU.** Babylon regenerates the
fragment shader with an empty argument slot —
`computeShadowWithCSMPCF1(index0, vPositionFromLight0[index0], vDepthMetric0[index0], , shadowTexture0Sampler, ...)`
— which fails to parse as a validation *warning*, floods the console, and
leaves the board rendering without shadows. It cost one whole probe run. Change
it in `stage.ts` and rebuild.

## What `standing.ts` knew, before its comments were stripped (2026-09-13)

**`heightAt` is not the surface anybody can see.** The terrain mesh carries one
vertex per half-foot and interpolates, so where ruts are cut in — most of this
board's track — the triangle between two samples runs above the height field in
the hollows. A trunk placed at the field's value for its centre floats by the
depth of the rut, which is what the tree standing in the road showed. Sample the
lattice the mesh actually uses, across the trunk's footprint, and take the
lowest.

**A glTF node is a plant; a primitive is one of that plant's materials.**
Babylon splits a multi-primitive node into `<node>_primitive0..N` children, so
the flat mesh list runs bark, leaves, twigs of plant one, then of plant two.
Indexing that list picks a *material*, not a plant — which is how `searsia_lucida`
shipped as five copies of one bush's twigs and ten of another's bark: a field of
disconnected sticks and bare trunks.

**Bake the world transform into the vertices first.** A glTF arrives under a
`__root__` carrying the handedness flip, and a thin instance's matrix composes
against whatever world matrix the mesh already has, so every instance lands
somewhere else entirely. `setParent(null)` keeps the world transform where
clearing `.parent` would drop it; baking flattens it and flips the winding with
the determinant.

**The trunk is the anchor, not the bounding box.** A plant's overall box bottoms
out at the tip of a drooping branch, well below the trunk's base — rebasing on
that stands the tree on its lowest leaf with the trunk in the air. Use the bark
primitive's own lowest point and horizontal centre.

**`MergeMeshes` builds its result in the scene already.** Adding it again put
`island_tree_02` in `scene.meshes` twice, and a mesh listed twice is dispatched
twice: every tree drawn two times for nothing visible.

**Leave a scan's scale alone.** `island_tree_02` is 3.4 m and the biggest
`searsia_lucida` is 2.3 m. Asking for a seventeen-foot field tree out of a
four-foot shrub is a twelvefold blow-up, and canopy leaf density falls with the
cube of it — which is why the scrub came out pale and see-through with its stems
showing.

**`url`, not `name`, to find a scan's atlas.** The glTF loader names a texture
after the material that uses it ("island_tree_02_leaves (Base Color)") and keeps
the path in `url`, prefixed `data:`. Reading the name finds no `_diff_` in
anything and masks nothing at all — a fix that looks applied and is not.

**Only mask the cut-out materials, and `OPAQUE` is zero rather than null.**
Testing for null let bark and branches through and handed them masks named after
atlases that have none, which resolved to 404s.

**Test, never blend.** A thin-instanced mesh is one draw call in buffer order and
Babylon has no thin-instance sorting at all, so blended foliage cannot resolve
against itself however it is configured.

**The board margin is a veto, not a weight.** It used to be one term of a sum, so
a candidate with a strong drift behind it could still be planted on the rim with
a crown two dozen half-feet across hanging over nothing.

**Trees cast and the meadow does not.** A tree is the one thing here whose shadow
is worth a shadow map — large, sharp at this cascade resolution, and the dark
patch under it is most of what says there is a tree there when the camera is
overhead. A plant a foot across is under one texel of a cascade covering the
board, so ground flora neither casts nor receives.

**The hand-built tree was refused and why.** The first version was a ball of
cards and looked like Minecraft; with no branches between trunk and crown the
canopy hung above a post. A scan states a shape exactly and a card only has to
carry it — but a tree is not one shape, it is a structure, and composing one out
of foliage clumps reads as a stack of boxes however the cards are arranged.


## The sward is the twist, and the other two are gone (2026-09-13)

Decided on the board rather than in the lab: the twist runs about five frames
ahead of cards and far ahead of blades, and the blade no longer carried enough
extra fidelity to argue for itself once the cards were leaned over and given
nine a plant.

What that removed, rather than left switchable:

  - `bab/blade-geometry.ts` and `lab/blade.ts`, deleted, with the lab's entry.
  - `EDGE_FAN` in `foliage-cards.ts` is `tan(0.3π)` now, not 0.3 — so
    `cardGeometry` *is* the twist and there is no second path. `LeafShape`,
    `CARD_SHAPE`, `cardShape(fan)` and the `leaf` override parameter existed
    only so blades could be swapped in; all gone, along with the helper
    exports (`spanAt`, `cross`, `add`, `scale`, `lift`, `Vec`, `Build`) that
    only `blade-geometry` imported.
  - The board's `Shape` type, sward switch, `grown` map, `setShape` and
    `resowing` signal are gone; `grow()` takes no argument.

**Two edits by script went wrong and the build caught both**, which is the
argument for never hand-slicing TypeScript by index: deleting the `LeafShape`
declaration took the `LEAF_LIFT` and `EDGE_FAN` constants with it, and removing
the shapes array left an unbalanced `))`. Both were plain compile errors, which
is the good case — unlike the page below.

## Two checks that were checking nothing (2026-09-13)

Both reported green for hours.

  - **`wgsl-lint` with no arguments linted no files** and printed `wgsl clean`.
    It walks `projects/` now — 157 files.
  - **The plan page's "js parses" check** sliced from `s.indexOf("const PLAN")`,
    and there is no `const PLAN` in that file. `indexOf` returned −1, the slice
    came back empty, and an empty string always parses. Meanwhile an unescaped
    `class="mono"` inside a double-quoted string had ended the string early and
    killed the whole `<script>`, so **the page rendered nothing at all** and was
    published to the artifact in that state.

`tools/page-check.mjs` replaces it: it loads the page in the browser, counts
rendered items, fails on console errors, and fails if named text is missing.
Note that port 4300 serves `dist/`, not `public/` — a plan-page edit needs the
file copied across (or a build) before the check means anything.

## Every screenshot of this board had a noise floor (2026-09-13)

The board runs `TAARenderingPipeline` at **16 samples with a 0.16 blend**
(`stage.ts`). Temporal anti-aliasing works by jittering the projection matrix a
fraction of a pixel each frame and blending the result into a history buffer.
On grass — which is nothing but high-frequency edges — that moves a great many
pixels every frame.

Measured with the camera byte-for-byte static, the wind stopped and nothing in
the scene changing, comparing consecutive captures:

| capture method | mean difference | worst pixel |
|---|---|---|
| single frames, TAA on | **0.514 / 255** | **57** |
| mean of 24 frames, TAA on | 0.136 | 10 |
| single frames, **TAA off** | **0.000** | **0** |

So **0.5 mean and 57 max was the floor under every image comparison in this
file**, and it was never subtracted. What that costs:

  - **"Card and twist are 0.78 mean apart" was measuring the noise**, not the
    twist. The conclusion — that the twist cannot be seen at a leaf-normal
    blend of 100% — still stands, because the 45% reading (5.35) and the
    blend-off reading (6.31) are an order of magnitude above the floor and both
    show the twist plainly. But the 0.78 figure meant nothing.
  - The shadow-proxy readings (1.01 and 1.31 against a 1.88 full range) are
    only two to three times the floor. Directionally right, worth re-running.
  - Anything quoted below about 1.5 mean should be treated as unmeasured.

**The fix is `bab.shot(width)`**, on the debug handle. It switches the jitter
off, stops the wind, waits four frames, grabs the canvas, and restores both in
a `finally`. Three consecutive calls return byte-identical PNGs. `Stage` gained
`jitter(on)` / `jittering()` for it.

Use `bab.shot()` for every A/B. Hand-rolled `drawImage` in a probe is how this
happened, and it is also focus-dependent: the same grab returns pure white when
the Chrome window is behind another, and pure black in some occluded states,
with no error either way.

**The camera was never the problem.** Several runs looked like the camera was
drifting between captures. It was not: `alpha`, `beta`, `radius` and the view
matrix are identical across grabs — only the *projection* matrix changes, in
elements 8 and 9, which is exactly where the jitter offset lives. A diagnostic
that seemed to show the camera resetting was itself wrong: it set `alpha`
*before* `setTarget`, and `ArcRotateCamera.setTarget` recomputes alpha, beta and
radius from the camera's position. Set the target first, always.

## The bald patch: 1.4's place field was far too strong (2026-09-13)

Reported from the board, not found by me: a large region beside the road with
almost no plants, and what was there lay flat. Intended mechanism, wrong
magnitude, and **I never looked at the whole board after shipping 1.4** — every
shot I took was close or at the play camera.

Three things compounded:

  - `placeA` ran at `where2 * 0.013`, a wavelength of about 77 half-feet on a
    440 x 300 board. That is roughly six noise cells across the whole field, so
    one low cell is an enormous region, not a mown patch.
  - `unmown` floored at **0.56** of normal height, and `alive` separately
    multiplied by **0.80** in the same places. `grow` multiplies by `alive` too,
    so effective height in a low patch was 0.56 x 0.80 = **0.45** — and 20%
    fewer plants standing at it.
  - Those short plants still carry 1.1e's lean of 0.90, so a 45%-height plant
    with cards leaning up to 78 degrees reads as a flat mat rather than short
    grass.

Now: three octaves (0.013 / 0.037 / 0.094) weighted 0.42 / 0.34 / 0.24 so the
structure is patchy rather than one swell; `unmown` floors at **0.82** and tops
at 1.24; `trodden` takes at most 30% instead of 48%; and `alive` follows place
only between 0.94 and 1.06. Worst case is 0.82 x 0.70 = 0.57, and that only
happens at the very edge of the track, which is where short grass belongs.

**The rule this earned:** after any change to the compute pass, photograph the
whole board from above. Field-scale structure is invisible at the play camera
and at close range, which is where every one of my shots was.

## The bald ground was the species lottery, not the wear or the stature (2026-09-13)

I guessed twice and was wrong twice. The third attempt read the data.

`tools/board-survey.mjs` reads every species' instance matrices straight out of
the storage buffers, bins the positions across the board, prints a density map,
and then takes eight top-down tiles with `bab.shot()`. What it said:

  - **95 bins with no plants at all — every one of them `wear` 254 or 255.**
    That is the road. Correct, not a bug.
  - **97 bins with no grass but other species present — every one `wear` 0.**
    Clean ground where grass alone was excluded. That is the bald ground.

The cause is `driftAt`, which clamps: `clamp((raw - 0.5) * 1.9 + 0.5, 0, 1)`.
Any noise value under 0.237 becomes **exactly zero**, which is about a quarter
of the board. A species' weight is `share * drift^clumping * (clumping + 1)`,
so where grass's drift clamps to zero its weight is zero, `relative` is zero,
and **no grass is placed at all** — while clover and plantain, on their own
noise fields, carry on. Grass's `patch` of 0.012 is an 83 half-foot wavelength,
so each of those regions is enormous.

Fixed with a per-species **`hold`**: the least of its slots a species keeps
however the competition goes, carried in the spare `w` of the `kinds` uniform
and applied as `relative = max(won, hold)`. Grass holds 0.72 — it is the matrix
species and must never vanish; clover 0.18, plantain 0.12, Yorkshire fog 0,
because being patchy is the whole point of that one.

Empty bins after: grass 152 → **74**, clover 215 → **75**, plantain 305 → 80,
and the remainder is the road. Grass placed 112,594 → 129,039.

**The rule:** when something is missing from the board, read the instance
buffers and the ground field at the missing places before touching a constant.
Both of my guesses — the wear field, then 1.4's stature — were wrong, and the
data said so in one run.

## 2.5: trees and scrub are vertex-bound, not fill-bound (2026-09-13)

Split by switching each group out of the scene, wind stopped, green coverage
reported for every arm so a blank arm could not pass:

| | play camera (r 300) | far camera (r 900) |
|---|---|---|
| everything | 30.8 ms | 20.7 ms |
| without the big tree | 28.2 | 19.1 |
| without the scrub | 29.6 | 20.0 |
| neither | 26.8 | 18.3 |
| **the scans cost** | **4.0 ms** (tree 2.6, scrub 1.2) | **2.4 ms** (tree 1.6, scrub 0.7) |

**The decisive number is the far camera.** There the whole board covers 3.75%
of the view and the scans are a few dozen pixels — and they still cost 2.4 ms,
sixty per cent of what they cost at the play camera. Green coverage moves
35.58 → 35.95 when every scan is removed, so at the play camera they are
drawing **0.4% of the screen for 4.0 ms**.

That is geometry, not fill. The scans submit **4,224,480 triangles every
frame**: `island_tree_02` is 1,072,213 x 3, and the three `searsia_lucida`
parts are 113,405 x 4, 77,603 x 5 and 27,701 x 6. A 3.4 m plant carrying a
million triangles is never going to be worth it on a board where it covers a
few hundred pixels.

## 3.1: MSAA is `taa.msaaSamples`, and it is already wired to 1

`TAARenderingPipeline` exposes `msaaSamples` (default 1), which sets
`_taaPostProcess.samples` — that is the modern spelling of the
`pipeline.samples = 2` the plan refers to. `stage.ts` already sets it
explicitly to 1, so turning it up is a one-line change, not new plumbing.

The 24 ms that refused MSAA came from `antialias: true` on the **engine**,
which is swapchain MSAA over the whole chain and a different mechanism.

`engine.setAlphaToCoverage(true)` exists on the WebGPU engine
(`Engines/WebGPU/Extensions/engine.alphaToCoverage`), so 3.2 is reachable the
moment samples go above 1 — and the grass is alpha-tested cut-outs, which is
exactly what alpha-to-coverage is for.

## 2.5 closed: refused to the asset, with the levers measured (2026-09-13)

The scans cost **4.2 ms** at the play camera, split by swapping the shadow
caster list and the meshes independently:

| | ms |
|---|---|
| everything | 30.5 |
| scans out of the shadow map | 29.4 (**shadow pass 1.1 ms**) |
| scans not drawn | 26.9 (**camera pass 3.6 ms**) |
| neither | 26.3 |

Four levers were tried and measured. None of them is the answer:

**It is not fill.** At a camera where the whole board is 3.75% of the view and
the scans are a few dozen pixels, they still cost 2.4 ms — sixty per cent of
their play-camera cost. At the play camera they draw **0.4% of the screen**
(green 35.58 with, 35.95 without).

**It is not the material.** One-sided lighting 33.0, back-face culling on 32.8,
against a 32.9 baseline — nothing. `material.freeze()` is **2.4 ms worse**.

**It is only half the triangle count.** Thinning the indices 7× (4,224,480 to
620,023) recovers 1.9 ms of the 3.6. The other 1.7 stays.

**And thinning destroys the tree.** At 25% kept it has lost most of its leaves;
at 12% it is a bare skeleton. The leaves *are* the triangles, so any
hash-thinning of a photogrammetry canopy removes foliage rather than detail.
Refused on the picture, not on the number.

The asset is the problem. `island_tree_02.gltf` is one node, `..._LOD0`, with
no LOD chain: **trunk 27,298 triangles, leaves 714,744, branches 330,171** —
1,072,213 for a 3.4 m plant that covers a few hundred pixels here. The same
conclusion as the pale rosette cut-outs: the fix belongs in the asset, not the
renderer.

**What is still worth taking, and is not done:** `shadowProxy` only fires over
200,000 triangles, and the three searsia parts are 113,405, 77,603 and 27,701 —
so **all of the scrub still casts at full resolution**. Lowering the threshold
would take a bite out of the 1.1 ms shadow half. Untested.

A proper LOD chain would need one mesh per plant rather than thin instances,
because `addLODLevel` picks by distance to the master mesh and all instances of
a thin-instanced mesh share one. That is 18 meshes instead of 4 — cheap in draw
calls, but a real change to `plantScans`, and not worth it until there is a
lower-poly tree to swap in.

## Looking for a lighter tree (2026-09-13)

**Poly Haven has no lower-poly island_tree_02.** Its 1k / 2k / 4k / 8k tiers are
*texture* resolution only — all four glTF entries share one 40.7 MB geometry
binary. There is no LOD chain in the file either: a single `island_tree_02_LOD0`
node.

Every other broadleaf they have is **worse**. Triangle counts read from the
glTF accessors, and binary sizes from the API where not counted:

| asset | triangles | note |
|---|---|---|
| **quiver_tree_02** | **82,074** | 13x lighter than what is on the board |
| othonna_cerarioides | 118,149 | but that is **seven** separate plants, ~17k each |
| **quiver_tree_01** | **150,124** | trunk 36,970 + leaf 113,154 |
| *island_tree_02 (current)* | *1,072,213* | trunk 27,298 + leaves 714,744 + branches 330,171 |
| island_tree_01 | 1,599,403 | trunk 34,787 + leaves 1,060,032 + branches 504,584 |
| island_tree_03 | ~2.1M | 79.6 MB binary |
| jacaranda_tree | ~5.5M | 208 MB |
| fir_tree_01 | ~12.6M | 478 MB |
| pine_tree_01 | ~25M | 949 MB |

So within Poly Haven the only light trees are the **quiver trees** — and a
quiver tree is a desert succulent: smooth pale trunk, dichotomous branching, an
aloe rosette instead of a canopy. A different plant, not a cheaper version of
the same one. Worth looking at in the Assets panel before ruling in or out; the
board's scrub is already a South African shrub, so it is less foreign than it
sounds.

Off Poly Haven, what CC0 offers at low triangle counts is **stylised** low-poly
— Sketchfab, Quaternius, CC0Tree and the rest. On a board whose grass is
photographs and whose scrub is a scan, a faceted cartoon tree is the wrong
object, so none of those were pursued.

The remaining option that keeps this exact tree is **offline decimation in
Blender**: QEM on the `branches` primitive alone, which is 330,171 triangles of
solid twig geometry and is what QEM handles well, leaving the 714,744 leaf-card
triangles untouched. That is asset work, not renderer work, and it is the only
route that keeps the silhouette.

## The quiver trees are a different plant, not a cheaper tree (2026-09-13)

Both pulled down and looked at in the Assets panel, which grew a **candidates**
shelf for exactly this: an asset listed and previewable with `count: 0`, so it
can be judged before anything places it on the board.

| | height | triangles | what it actually is |
|---|---|---|---|
| quiver_tree_01 | 2.72 m | 150,124 | a bare pole with a small tuft on top |
| quiver_tree_02 | 1.47 m | 82,074 | a squat aloe, reads as a palm or yucca |
| *island_tree_02* | *3.41 m* | *1,072,213* | *a broadleaf with a spreading canopy* |

Neither is a shade tree. `Aloidendron dichotomum` is a succulent: smooth pale
trunk, dichotomous fork, aloe rosettes where a canopy would be. In a green
meadow they read as desert palms. Refused on the look.

Two useful facts from the trip:

  - **Neither has an alpha map** — only `diff`, `arm` and `nor`, and the glTF
    material is `OPAQUE`. The rosettes are real geometry, not cut-out cards, so
    none of the mask traps apply to them. That is also why 82k triangles is
    enough for a whole plant.
  - **Poly Haven's download URLs refuse `urllib`** with a 403 and want a
    browser user agent; `curl -L -A "Mozilla/5.0"` works.

The files are kept under `assets/board/models/` (6.3 MB the pair) so the
judgement can be re-run without downloading again. Delete both folders and the
`CANDIDATES` entries to drop them.
