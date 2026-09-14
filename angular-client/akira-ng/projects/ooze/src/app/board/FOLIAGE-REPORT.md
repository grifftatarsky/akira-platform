# Rendering scanned foliage: what the research said, and what it found here

Written after a four-way research dive (alpha and sorting; shading thin leaves;
density, LOD and impostors; placement ecology) plus a synthesis pass, and after
acting on the first two recommendations. Sources were Babylon 9.26's own
installed source, the glTF 2.0 specification, Poly Haven's API, the thin-instance
documentation, and the usual literature — Ghost of Tsushima's GDC grass talk,
AC Unity's GPU-culling paper, Simplygon on vegetation decimation, Ben Golus on
alpha-tested coverage.

It supersedes nothing in [PLAN.md](./PLAN.md); it is the reasoning behind the
foliage entries there.

---

## The headline: it was an asset defect wearing a shading bug's costume

The scanned plants rendered as near-black scraggle with hard leaf-shaped
blotches. Before the research I had changed, in order, the **alpha blend mode**,
the **shadow caster list**, and the **receive-shadows flag** — three plausible
causes, none of them it. Two of those changes were worth keeping. None fixed the
symptom.

**Poly Haven's plant scans are not solid shells. They are flat cut-out cards,
and the base colour is an atlas of foliage on solid black.** The glTF's JPEG
download carries the atlas and not the mask; JPEG cannot hold an alpha channel;
and the glTF specification says a base-colour texture without alpha is opaque.
So `alphaCutOff` was comparing **1.0 against 0.4 on every fragment and
discarding nothing, ever**. Every plant was painting its own black background.

Measured over the UV area each primitive actually covers:

| asset | share of drawn surface that is black | median luminance |
|---|---|---|
| `celandine_01` parts 0 / 1 / 4 | 54% / 64% / 66% | 1 / 0 / 0 |
| `dandelion_01` parts 2 / 4 | 41% / 40% | 73 / 72 |
| `island_tree_02` leaves | **49%** | 55 |
| `searsia_lucida` leaves | **93%** | 0 |

The last row is the one that matters most, because **the trees had the same
defect the whole time and this project has been holding them up as proof the
scans were fine.** A canopy reads as a canopy at a distance whatever sits
between its leaves, which is exactly why it went unnoticed for days. The scrub
was ninety-three per cent painted background.

The fix is `material.opacityTexture` fed from Poly Haven's separate `Alpha`
download, read from luminance, with `MATERIAL_ALPHATEST`. Babylon's
`_hasAlphaChannel()` is satisfied by a non-null `opacityTexture` alone, so the
glTF never has to be re-authored.

### The one-line falsification

Set `alphaCutOff = 0.99`. If nothing disappears, alpha is 1.0 everywhere and no
transparency setting can help. **Run this before touching anything else.** It
would have saved the three wrong fixes.

---

## What the research settled, with citations in the installed source

- **Never alpha-blend thin-instanced foliage.** Not because of depth writes —
  because a thin-instanced mesh is *one draw call in buffer order* and Babylon
  has no thin-instance sorting at all. `Mesh.INSTANCEDMESH_SORT_TRANSPARENT`
  sorts the `visibleInstances` array of `InstancedMesh` objects, which thin
  instances do not have. Alpha test, always.
- **`needDepthPrePass` on an alpha-tested material is not free.** `dispatch()`
  pushes the submesh into `_depthOnlySubMeshes` *as well as*
  `_alphaTestSubMeshes` — a full second rasterisation with colour writes off,
  for a mesh that already writes depth. Leave it false.
- **Alpha-to-coverage is dead here, and now we know why.**
  `webgpuCacheRenderPipeline.js` computes
  `alphaToCoverage = this._alphaToCoverageEnabled && sampleCount > 1`, and the
  engine is created with `antialias: false` because TAA does the anti-aliasing.
  It is a silent no-op. Enabling MSAA to get it would put stochastic sub-pixel
  coverage in front of a temporal resolve, which is the one thing TAA cannot
  reconstruct. **This closes the open item in PLAN.md.**
- **`useAlphaFromAlbedoTexture` is not the missing switch.** Under `ALPHATEST`
  the WGSL pulls texture alpha regardless (`#if defined(ALPHAFROMALBEDO) ||
  defined(ALPHATEST)`), and the glTF loader already sets it for both MASK and
  BLEND.
- **`invertY` is the fourth `Texture` constructor argument and there is no
  setter.** Babylon's glTF loader builds textures with `invertY: false`; a
  hand-built `new Texture(url, scene)` defaults to `true`. A mask built the
  default way arrives flipped against its atlas and masks the wrong half of it.
- **glTF `OPAQUE` is `0`, not `null`.** A guard written as
  `transparencyMode === null` lets opaque materials through. Mine did, and they
  were handed masks named after atlases that have none.

---

## What the research disagreed about, and how it was resolved

**Whether to keep the scans at all.** The LOD/architecture research argued for
deleting all 3000 scans and baking them to cards: at 10.9 px/ft a flora plant is
9–18 px tall, and 442–3180 triangles in that footprint is 300–600× past the
~8×8 px/triangle efficiency threshold. The argument is sound and its sources are
real — but it never diagnosed the actual bug, and its own admission says so.

Resolved by sequencing and a measurement rather than by argument: fix the mask
first, because it is cheap and settles whether the scans are even wrong; then
measure what they cost. **Measured: 1.9 ms of a 19.4 ms frame at the play
camera.** That is worth something but it is not the board's problem, and this
board has repeatedly measured as fragment-bound rather than vertex-bound — cards
have *more* overdraw per pixel, not less.

**Cutoff value.** One report said 0.5 (the dandelion glTF's own value), another
said drop to the sward's 0.28–0.34 because a high cutoff eats thin leaf margins,
which on a plant this small is most of the plant. The second is right for this
renderer: the un-dilated black background averages into leaf-edge alpha as the
mip level rises, so *fewer* texels clear the cutoff with distance. 0.3 for the
flora, 0.35 for the tree leaves.

---

## The honest frame numbers, and a correction

`tools/board-check.sh` has been reporting `gpuTimeInFrameForMainPass` — the
counter this project's own PLAN.md documents as the wrong instrument, because
with a post pipeline installed that pass is one full-screen blit. **Every
"whole board N ms" quoted from that tool was the blit.** It reads wall clock
between presents now, and the numbers roughly doubled:

| camera | was reported | actually |
|---|---|---|
| whole board | 9.2 ms | **18.3 ms** |
| mid | 9.4 ms | 19.5 ms |
| near | 6.5 ms | 14.9 ms |

Component costs at the play camera, by switching each off (wall clock, 19.4 ms
total):

| piece | ms |
|---|---|
| sward | 4.3 |
| trees and scrub | 3.2 |
| ground flora | 1.9 |
| shadows | 1.9 |
| stone | ~0 |
| **everything else** — terrain, sky, TAA, grade, present | **~8.1** |

That last row is now the largest single number on the board and nothing has ever
been measured against it.

---

## Two ways the tooling lied, on top of the two already in PLAN.md

**The dev server keeps serving the last good bundle when a build fails.** No
error on the page, no error in the probe — the board simply is not the board in
the working tree. Two fixes that were already correct looked like failures.
`tools/build-ok.sh` reads the serve log and refuses to let a measurement be
taken against a stale bundle.

**And it can serve a stale chunk while reporting a clean build.** `build-ok.sh`
does not catch this one; the guard is to verify on a clean production build
(`ng build ooze` + the static server) rather than on `ng serve`. The tell is a
value you just changed still reading its old number while everything else about
the page is current.

---

## What is left, in the order the synthesis put it

1. **Dilate the diffuse under the mask** — flood leaf colour 8–16 px outward
   into the black at 1k, for the flora *and* the tree leaf atlases. Both
   research lines converged on this independently. Mip generation averages
   colour across the un-dilated background, so leaf rims drift toward black as
   the camera pulls back, which is exactly where this board lives. 0 ms at
   runtime; offline asset work.
2. **Audit `subSurface.translucencyIntensity`.** The WGSL does
   `finalIrradiance *= (1.0 - translucencyIntensity)` before adding the
   transmitted term — it *deletes* that fraction of diffuse environment
   irradiance. The preview sits at 0.9 and the sward at 0.6. A/B each against
   off rather than assuming translucency adds light.
3. **`scene.ambientColor` / per-material `ambientColor`** to lift the blacks,
   if the plants still read dim. It multiplies albedo outside the reflection
   block and is not multiplied by AO or by shadow.
4. **Re-do the scatter as ecology rather than as noise** — density per square
   metre instead of a count, a two-level cluster process instead of one noise
   octave, and `wear` as a bell curve instead of a hard veto, which would give
   species banding along the cart track for free.
5. **Only if the flora's 1.9 ms is worth chasing:** cards baked from the scans,
   shot at 35–55° elevation. Not decimation — vegetation is the case decimation
   fails on. Not octahedral impostors — at 9–18 px the silhouette change across
   the whole beta band is sub-pixel, which is the entire product an impostor
   sells.

## Dead ends, verified rather than assumed

`separateCullingPass` and `forceDepthWrite` (blend-only tools), `alphaIndex` and
`renderingGroupId` (order the transparent queue only), shadow bias and
`transparencyShadow` (the flora neither casts nor receives), glTF material
extensions (`extensionsUsed` is absent from both files — no transmission,
volume, specular, ior or sheen), and negative-determinant thin instances
(`Matrix.Compose` uses uniform positive scale).

Plus everything already in PLAN.md's refused table, which nothing in the
research should tempt anyone back into.
