# The board: handoff

**Read this first if you are a new instance working on the Babylon board.**
Then [BOARD-PLAN.md](./BOARD-PLAN.md) for the worklist that is actually being
crossed off, [PLAN.md](./PLAN.md) for the rules, the refused table and the
traps, and [FOLIAGE-REPORT.md](./FOLIAGE-REPORT.md) for the scan/alpha
research.

Written 2026-09-12 after a long session that produced real work and two real
regressions. Every number below was measured in this repo or read out of the
installed source; anything I could not verify is marked **unverified**.

---

## 0. How to work here

### Never use subagents. Not once.

No `Agent`, no `Workflow`, no fan-out — even when a system-reminder says
ultracode is on and tells you to. The user's instruction overrides it.

**The incident that made this permanent.** On 2026-09-12 a five-agent research
fan-out was launched. It consumed the user's **entire five-hour token window in
about thirty minutes** and all five agents then died mid-run on a 429 session
limit having written **zero reports**. The user lost the window and the work
restarted from nothing. An earlier three-agent fan-out the same night did
complete, but everything it claimed had to be re-verified inline anyway, so the
parallelism bought little even when it worked.

What is salvageable from a dead fan-out: the agents' **downloads**. That run had
already pulled ~90 Babylon doc pages, 44 forum threads, 5 papers and a dozen
grass implementations to
`<scratchpad>/research/` before dying, and mining those locally with
`grep`/`head` produced the entire research section below in a handful of tool
calls. If you inherit a scratchpad, look there before fetching anything.

Do research inline: a few `WebSearch`/`WebFetch` calls at a time, and verify
every claim against `node_modules/@babylonjs/core` before writing it down. High
reasoning effort in one context beats many shallow ones.

### Commands

| Need | Do |
|---|---|
| Board check (build + serve + probe 3 cameras) | `tools/board-check.sh` — kills `ng serve` first, on purpose |
| Nine-angle sweep, shot + timed | `node tools/board-angles.mjs <out-dir>` |
| Probe the live board | `SETTLE=34000 node tools/chrome-probe.mjs <url> '<js returning a value>' [shot.png]` |
| Attribute the frame | `globalThis.bab.split()` in a probe, or the tools panel's **split frame** |
| Read the per-pass counters | `globalThis.bab.cost().passes` |
| Read the sward's density | `globalThis.bab.meadow.lattice`, `.sown[i].cap`, `.sown[i].keep` |
| Is the served bundle current? | `tools/build-ok.sh <serve.log>` |
| WGSL + Angular-template lint | `node tools/wgsl-lint.mjs projects/ooze/src/app/board/bab/*.ts` |
| Tests (126) | `npx ng test ooze --watch=false` |
| Full frontend build | `PATH="$PWD/node_modules/.bin:$PATH" ./devbuildall.sh` |

`PATH` needs `/usr/bin:/bin:/opt/homebrew/bin` prepended in Bash calls here, and
`ng` is only on `node_modules/.bin`.

A real Chrome with CDP must be running for any probe, and **it should be a
freshly started one** (§0):
```bash
pkill -f "remote-debugging-port=9333"; sleep 3
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9333 --user-data-dir=/tmp/chrome-probe \
  --enable-dawn-features=allow_unsafe_apis --no-first-run \
  --no-default-browser-check --window-size=1800,1100 about:blank &
```
The dawn flag is what makes WebGPU timestamps work (§3). The in-app browser pane
cannot render WebGPU reliably — it logs "Destroyed texture
[WebgpuSwapChainTexture] used in a submit" and draws a board that is perfect on
the same machine in a real Chrome — which is why this exists at all.

`chrome-probe.mjs` drives the tab whose URL matches the one you pass, so the
three standing tabs (board, plan, lab) do not fight over it; `CDP_TAB` overrides
the match.

### The code carries no comments

The user's rule, from 2026-09-12: every file touched in a pass gets its comments
removed, because an agent reads a comment as truth and then does not re-read the
code against it. Four wrong beliefs on this board came from exactly that.

What a comment cannot be recovered from — *what was tried and did not work* —
lives in `PLAN.md` under **Traps that used to live in comments**. Read it before
changing `terrain.ts`, `meadow.ts`, `splat-bake.ts` or any WGSL here.

### Two rules the audit added, and they outrank the renderer

**Restart the browser before a measurement session.** A Chrome that has been
reloading the board all session leaks WebGPU adapters, and the board gets slower
without a word: the same frame at the same resolution read 23.9 ms on a worn
browser and 21.5 ms on a fresh one, and the sward alone read 8.57 against 4.88.
Every number published before this audit was taken on a worn browser. The
documented symptom of the same leak is `requestAdapter` hanging with no error
anywhere, which is how this was found.

**Pin the resolution and read it back.** `adaptToDeviceRatio: true` takes the
pixel count from whichever display the window landed on, so a probe window on a
non-Retina screen renders a quarter of the pixels and nobody is told. One audit
run came back at exactly 16.67 ms with every component at 0.0 — that is the 60 Hz
refresh, not a fast board. `board-check.sh` and `board-angles.mjs` now call
`setHardwareScalingLevel` (`SCALING`, default 0.5) and report the render size,
and `FrameCost` carries `pixels` and `megapixels` so the HUD always shows it.
**A frame number without its pixel count is not a measurement.**

### The four ways this project has lied to itself

1. **`board-shot.mjs` does not navigate.** Run `chrome-probe.mjs <url>` first or
   you are photographing the previous build.
2. **`ng serve` serves the last good bundle when a build fails** — no error on
   the page, none in the probe. `build-ok.sh` catches it.
3. **`ng serve` can serve a stale *chunk* even when the build succeeded.**
   `build-ok.sh` does **not** catch this. The tell is a value you just changed
   still reading its old number. Verify on `ng build ooze` + static serve.
4. **A WebGPU canvas reads blank outside a frame callback**, including from
   `scene.onAfterRenderObservable`. Capture with `drawImage` inside
   `requestAnimationFrame`. A toggle pixel-diff returned all zeros twice for
   this reason and was believed the first time.
5. **A GPU pass counter no longer being written keeps reporting its last
   average**, and the post-chain counters overlap and cannot be summed. §3.

Skills exist for this: `.claude/skills/board-measure`, `foliage-scan`,
`graphics-lab`.

---

## 1. Where the board actually is

Measured 2026-09-12 and audited the same day. **Read the two rules under §0
before quoting any of it** — the audit found the browser's age and the probe
window's display mattering more than anything in the renderer.

Play camera (alpha -1.15, beta 1.02, r 300), **3600 x 2026 — 7.29 MP**, midsummer,
sward at 100%, fresh browser, hardware scaling pinned to 0.5:

| | |
|---|---|
| **whole frame** | **21.5 ms — 47 fps** |
| standing in the field (r 26) | see the angle sweep; it is the cheapest stop |
| target | 16.6 ms |

Three bracketed `splitFrame` runs averaged, drift 0.37 ms:

| piece | ms | piece | ms |
|---|---|---|---|
| trees and scrub | 4.93 | ground relief | 0.18 |
| sward | 4.88 | sky dome | 0.13 |
| shadows | 4.03 | grade | 0.08 |
| terrain | 2.13 | **unattributed** | **1.22** |
| ground flora | 1.87 | | |
| temporal aa | 1.42 | | |
| stone | 0.28 | | |

**Trees and scrub is the largest piece, a hair above the sward.** On a worn
browser the sward measured 8.57 and looked like the whole problem. It is not.

Taking a group away also removes whatever it was occluding, so this is a
difference measurement, not a partition.

**The 8.1 ms unattributed baseline the first handoff called "the largest single
number on the board" does not exist** — it was `split-frame.ts` reading
`gpuTimeInFrameForMainPass`.

The board draws 230,937 plants at 100%, grass 112,597.

## 2. Open regressions

### 2a. The bald ring — closed

Three systems disagreed about where the sward stops: the sowing faded grass out
by wear 0.62, the ground bake painted grass to 0.82, and the shadow proxy stood
to 0.82. The band between was painted green, cast a grass shadow, and had
nothing in it.

`SWARD_FADE_FROM` / `SWARD_FADE_TO` in `bab/species.ts` are now the single
definition, read by `meadow.ts` (the sowing shader), `splat-bake.ts` (the ground
colour) and `terrain.ts` (the shadow proxy). Per-species `wearMax` is gone —
reintroduce it only as a modifier on the shared band, never as a second band.

**Verified:** a matrix readback binned onto a 44 x 30 grid has 122 cells under
20% of the densest cell and **every one of them is on the track** (wear > 0.82).
Off the track there are none.

### 2b. Absolute density — done, with one claim corrected

`MAX_PLANTS` was a budget split by share, so the mix, the density slider and the
lattice pitch were one number. Each species now declares `perArea` — plants a
square half-foot on unworn ground — and:

- the lattice pitch comes from the **densest** species (`TUFT` slots in its
  cell), not the rarest;
- capacity is a whole number of slots a cell and the leftover fraction is handed
  to the sowing lottery as `keep`, so rounding never changes how much of a
  species there is (a 3% species used to get a whole slot a cell, the floor);
- the slider scales `keep`, so it thins rather than re-deals — the fog used to
  double from 6,470 to 12,946 as the slider crossed one setting;
- `MAX_PLANTS` is a ceiling at 600,000 and `lattice.fit` reports when it bites.
  At 340,000 it still bound, scaling the whole table to 78%.

The arithmetic is `swardLattice()` in `bab/meadow.ts`, pure and unit-tested:
`bab/meadow-lattice.spec.ts` checks that adding or removing a species leaves
every other species' slots, cap and keep **exactly equal**, that the pitch comes
from the densest, that the ceiling scales the mix without changing it, and that
no species' `keep x crowd` exceeds one at any density.

**Two things the audit found and fixed.** Slots per cell were *rounded*, so a
species whose `wanted x crowd` landed just above an integer lost the capacity its
crowd asked for: Yorkshire fog's `keep x crowd` came to 1.44, its lottery
saturated at full density, and it returned 61% of itself at half density instead
of 50%. Slots are rounded **up** now (with a float tolerance, or the grass's
exact 5.0 becomes 6), and every species measures 0.498–0.502 at half density and
0.249–0.252 at a quarter.

And the criterion "adding or removing a species changes only that species'
count" is **too strong, and was never true of the count**. The *allocation* is
decoupled exactly — remove clover and every other species' slots, cap, keep and
the lattice are bit-identical, measured. The *drift lottery* is deliberately
coupled, because a species' share of a spot depends on what else wants it, and
that is worth up to 21% of a placed count: removing clover moved grass +0.7%,
fog +2.2%, plantain +20.6%. Plantain moves most because it has headroom under
its crowd; grass barely moves because it is already at its clamp.

The board opens at 100%. The default `density` was 0.5 while the slider read
100%, which is most of what "the grass looks thin" was.

### 2c. The scanned flora reads pale and scattered

The alpha-mask fix (§4a) was correct and necessary, but the flora still reads as
pale rosettes distributed too evenly, and they sit on top of the sward rather
than in it. Causes, in likely order: no colour dilation under the mask so leaf
rims drift toward the atlas's black with distance; a single noise octave for
drift; and `subSurface.translucencyIntensity` deleting diffuse irradiance (§4b).

### 2d. My own overstatement, corrected

I reported the alpha-mask fix as transforming the trees. The 93%/49% figures are
**texture-space** — the fraction of the atlas area the leaves' UVs cover that is
black — not screen area. On screen that black sat *between* leaves and read as
canopy shadow, which is why nobody noticed. The fix is right (the canopies have
real sky gaps now) but its visible effect on the trees was smaller than I said.
The flora was the part that was genuinely broken by it.

---

## 3. The two instruments, and which one to believe

Both exist now. They disagree, and the disagreement is the important part.

### `split-frame.ts` — the delta instrument. Trust this one.

Measures wall clock between presents, switches one piece off, measures again.
It drives the board's own `show` toggles rather than owning a second list of
meshes, so anything switchable is measurable and nothing can drift apart. The
button is in the tools panel; `globalThis.bab.split()` returns the slices.

It used to read `gpuTimeInFrameForMainPass`, which is the blit, which is why
every component number it ever produced was wrong.

**Each slice is bracketed, and the run reports its own drift.** It used to take
one baseline and compare thirteen readings to it across thirteen seconds; on a
machine whose load moved, every component inflated, and one audit run had the
parts summing to 73.6 ms of a 28.7 ms frame. Every `without` reading now sits
between the two on-readings either side of it, so linear drift cancels, and the
last row is the drift between the first and last baseline. **A run whose drift is
a large fraction of a component is not a measurement of that component.**

It stays blunt in one honest way: taking a group away also removes whatever it
was occluding, so the parts over-sum by about 4%.

### `gpu-passes.ts` — the per-pass counters. Real, but not additive.

Every WebGPU render target carries `gpuTimeInFrame`
(`Engines/WebGPU/webgpuRenderTargetWrapper.d.ts`), and so does every
`ComputeShader`. `framePasses()` walks the camera's post-process chain, the
shadow maps, the reflection probes, `scene.customRenderTargets` and the meadow's
compute shaders, and reads each. The HUD shows them.

Two things to know before quoting them:

1. **A counter that stops being written keeps reporting its last average
   forever.** Switch the post chain off and the `scene` target still reads
   13.8 ms of a frame it is no longer part of. `counterMs` drops any counter
   more than 60 frames behind `engine.frameId`. In steady state the lag is 4–5
   frames — the query read-back is asynchronous — so do not tighten that
   threshold.

2. **The post-chain counters overlap and must not be summed.** At 7.5 MP they
   sum to 48.8 ms against a 22.7 ms frame. Checked against the deltas: the whole
   post chain costs 1.9 ms of wall clock (TAA 1.5, grade 0.4) while its counters
   report 29. The scene and shadow counters do agree with the deltas, and with
   the post chain off entirely the counters sum to 16.9 against a 17.5 ms frame.
   The overlap grows with resolution and vanishes at hardware scaling 4, where
   the sum lands within 0.1 ms of wall clock. So: **`scene` and `shadow` are
   worth quoting; the post passes are worth watching relative to themselves and
   nothing else.** `FrameCost` deliberately carries no summed `gpuMs`.

### What is still not attributed

Nothing, at the play camera — `unattributed` reads 0.00 once the sky dome has
its own toggle. The dome was drawn every frame and had no switch, so it sat in
the remainder; `setSkyLight` toggles the image-based light, not the mesh.

### The lever nobody had pulled

`adaptToDeviceRatio: true` renders at 2x DPR. `engine.setHardwareScalingLevel(n)`
divides that, and it is close to linear:

| scaling | pixels | wall |
|---|---|---|
| 0.5 (default, 2x DPR) | 3600 x 2086 | 19.7 ms |
| 1 | 1800 x 1043 | 11.6 ms |
| 1.25 | 1440 x 834 | 10.4 ms |
| 1.5 | 1200 x 695 | 9.9 ms |
| 2 | 900 x 521 | 9.0 ms |

**Unverified** how any of it looks. That is Phase 2.1 and it is the cheapest
large experiment available.

**Snapshot rendering will not help.** Babylon's own doc: "the performance
improvement is on the JavaScript side only: GPU performance will be more or less
the same" (`webGPUSnapshotRendering.md`). This board is GPU-bound — CPU frame
time is 1.1 ms of a 23 ms frame.

## 4. Research findings, cited

Sources are on disk under `<scratchpad>/research/` (Babylon docs, 44 forum
threads, Jahrmann 2017, HZD vegetation, HFW deferred texturing, the Ghost of
Tsushima wind talk, Cohen Wang tiles, and ~12 grass implementations).

### 4a. The scan alpha bug (already fixed, keep the knowledge)

Poly Haven plant/tree scans are **flat cut-out cards on a black atlas**. The
JPEG download carries no alpha; glTF says a base-colour texture without alpha is
opaque; so the alpha test compared 1.0 against its cutoff and discarded nothing,
and every plant painted its own black background. Fixed by binding the separate
`Alpha` download as `opacityTexture` with `getAlphaFromRGB`. Full detail in
FOLIAGE-REPORT.md. **Falsify in one line before any other theory:**
`alphaCutOff = 0.99` — if nothing vanishes, alpha is 1.0 everywhere.

### 4b. The sward material is doing expensive things for nothing

`bab/meadow.ts` sets, on a material instanced 340,000 times:
`subSurface.isTranslucencyEnabled = true`, `translucencyIntensity = 0.55`,
`alphaCutOff = 0.28`, `backFaceCulling = false`, IBL opted out by overriding
`_getReflectionTexture`, and **no `material.freeze()`**.

Babylon's `pbrBlockFinalLitComponents` does
`finalIrradiance *= (1.0 - subSurfaceOut.translucencyIntensity)` before adding
the transmitted term — translucency **deletes** that fraction of diffuse
environment irradiance and substitutes a transmittance-scaled version. At 0.55
the sward is throwing away over half its ambient. A/B it against off; do not
assume translucency adds light.

The project's "a cheaper meadow material has a 2.0 ms ceiling" refusal measured
*unlit vs PBR*, which is the wrong comparison. The real question is PBR-with-
subsurface vs a purpose-written blade `ShaderMaterial`, which is what every fast
implementation uses (§4c).

### 4c. Thin instances of tiny meshes may be the wrong architecture

Babylon core dev Evgeni_Popov, forum 46756: *"Having X thin instances is faster
than having X meshes… but it's not necessarily faster than integrating all the
data directly into vertex buffers. The GPU has extra work to do when you use
instantiation… What's more, the basic mesh is just 2 triangles. Perhaps with a
larger geometry, the difference in performance would be smaller."* The thread's
measurement: **2 million quads — 60 fps baked into one mesh, 15 fps as thin
instances.** A 4× difference.

This board is 340,000 thin instances of a ~50-triangle mesh. That is the regime
the thread describes. **Unverified for this board** — it is a lab experiment, and
a big one, because the compute pass writes instance matrices.

**The existence proof the user asked for.** Forum 62558: *"totally blown away by
the speed of thin instances in combination with the ShaderMaterial… plants
1,000,000 grass blades on a heightmap and spawns 5 rolling spheres making impact
on the grass. As a performance optimization frustum culling is built into the
vertex shader."* A million blades, in Babylon, with a `ShaderMaterial`, culling
in the **vertex shader** rather than on the CPU or in compute.

Forum 56860, on 100k blades: a core dev reports *"a solid 120 fps"*, and another
respondent gets 60 fps on a 4060 laptop after reducing far-blade vertex counts,
adding *"if you use WebGPU you will get better performance."*

### 4d. The board's grass architecture is already the right one

Ghost of Tsushima's own pipeline, from the wind talk
(`rockenbeck-wind.txt`):

```
Grass Kind Map ┐
Grass Height Map ├→ Grass CS → Blade List ─┬→ Draw VS/PS
Terrain Height Map┘                 GDS ── Blade Count → Indirect Draw
                                    Finalize CS
```

That is *exactly* `meadow.ts`: a compute pass reading the ground field, writing a
blade/instance list with an atomic count, a one-thread publish pass, and an
indirect draw. **The bones are right.** Their stated philosophy is "Volume Over
Accuracy", and their wind model is `Vector + Noise + "Vorticles" (+ Displacement)`.

What the board is missing is in the *blade* and the *shading*, not the pipeline.

**Blade mesh.** Jahrmann & Wimmer 2017: a blade is three control points of a
**quadratic Bézier**, plus height, width, direction and a stiffness/physics
vector — "a blade of grass can be completely described by four 4D vectors". Also:
*"random clumping of blades is beneficial for a natural grass distribution…
tuft seeding generates a more natural grass distribution"* — which is why the
board's Voronoi clumping is right.

A working Babylon blade generator is on disk (`src/as-grassBlade.ts`):
`2·stacks + 1` vertices, width tapering to a single tip vertex, and — the part
this board lacks — **normals rotated ±0.3π about the blade's up axis**, so a flat
blade shades like a cylinder. The board's `EDGE_FAN = 0.3` is a weaker version of
the same idea applied to cards.

A full high-quality parameter set is in `src/revo-Grass.ts` (1,183,744 blades per
tile): base colour and tip colour with a mix factor, colour-variation strength,
AO by radius, wind-driven shading, per-blade min/max scale, NDC-space culling
with padding to hide rotation lag, and a player-trail displacement.

**The wind the user wants back** is still in the repo at `meadow.ts:1176-1215`
(the three.js version): a slow **front** that sweeps across and drops strength to
almost nothing between passes, a **body** of three waves phased on the crosswind
direction as well as downwind so crests are patches rather than bands, and a
**fast per-plant term** so neighbours are never in step. The current
`blade-wind.ts` has a weaker version of the body and no real front.

### 4e. HZD is a LOD ladder, honestly reported

Horizon Zero Dawn: GPU-based procedural placement, grass with **3 LODs**, plants
4, trees 5 ending in a billboard shader, and a stated goal of *"Zero percent
Overdraw!"*. The user has banned LOD that removes foliage in frame, and that ban
stands — but HZD's LODs change *representation* with distance, they do not thin
the field. Worth separating those two ideas when this comes up again.

### 4f. AA: MSAA with a post chain is configured differently than assumed

Babylon's answer to "MSAA is disabled when turning on postProcess" (forum 9302,
sebavan): *"Anti aliasing is only turned on by default on the main canvas
buffer, not manually created frame buffers… you can simply set the samples value
of the post process to your chosen number of samples."* And forum 7264:
`pipeline.samples = 4` (4 is the documented maximum).

The board sets `antialias: false` on the **engine** and `taa.msaaSamples = 1`.
The "MSAA costs 24 ms" measurement came from `antialias: true`, which allocates a
4-sample colour *and* depth target at full canvas — not from
`pipeline.samples`. **Unverified** whether `samples = 2` on the pipeline behaves
differently. This also gates alpha-to-coverage, which is dead only because
`sampleCount` is 1.

### 4g. SSAO2's white-out had a known, published cause

Forum 63942 (Aug 2026): SSAO2 on WebGPU **NaNs on the sky**, because the
background writes colour but no prepass depth/normal, the prepass normal is
(0,0,0), and WGSL propagates NaN from `normalize(0,0,0)` — WebGL drivers were
merely lenient. The fix is a geometry mask using the prepass normal's alpha.

**Both halves settled 2026-09-13.** The NaN is real and is patched into the WGSL
at the shader store (a `skyMask` from the normal's length, and a guarded
`select` normalize). The `excludedMeshes` half is real too, and it is the whole
cost: `GeometryBufferRenderer.renderList` set to the 51 terrain, tree and stone
meshes takes SSAO from **26.9 ms to 8.4** — 18.5 ms of prepass over 200k grass
instances. What the original refusal missed is that the cheap arm is also nearly
invisible, because the grass covers the ground the occlusion darkens. Both arms
are in the graphics menu. See `PLAN.md`, *Phase 3 closed as settings*.

---

## 5. The plan

Ordered by (value ÷ risk). **Every item gets a lab screen before it touches the
meadow** — see `.claude/skills/graphics-lab`. A lab screen is its own route with
an A/B switch, its own on-screen wall-clock measurement, and a pass/fail
criterion written *before* it is built.

### Phase 0 — instruments and regressions — done

| # | Work | Result |
|---|---|---|
| 0.1 | Per-pass GPU breakdown | Done, and it found the 8.1 ms baseline was an instrument fault rather than a cost. Both instruments are in the HUD, in `board-angles.mjs` and in `board-check.sh`. See §3 for which to believe |
| 0.2 | Bald ring | Done. One shared fade; coverage map has no thin cell off the track |
| 0.3 | Absolute density | Done. `swardLattice()` is pure and unit-tested; the board opens at maximum |
| 0.4 | **Lab harness** — `/board/lab` index plus one worked example screen | **Not started.** Phase 1 needs it |

### Phase 1 — the grass itself (the user's main complaint)

| # | Work | Working = | Not helping = |
|---|---|---|---|
| 1.1 | **Blade mesh**: quadratic-Bézier blade, `2·stacks+1` verts, tapered to a tip, **±0.3π rotated normals**. Lab against the current card side by side. | No visible repetition at the play camera; blades read as rounded, not as flat strips | > 1.0 ms over cards at equal density |
| 1.2 | **The old wind back**: front with lulls + three-wave body phased on crosswind + per-plant fast term. Lab with a wind-strength slider and a still/gust toggle. | Gusts cross the field as patches with visible lulls; no plane-wave carpet; reads as flow from *above* | > 0.3 ms (it is vertex-only) |
| 1.3 | **Blade variety**: per-instance hue/height/width/curve/tilt from the existing clump hash; base→tip colour with a mix factor; AO darkening at the root. | Two neighbouring tufts are never obviously the same object | > 0.3 ms |
| 1.4 | **Mixed sward structure**: trodden/flattened patches, mown verge, taller unmown drifts. | The field has places rather than one texture | — |

### Phase 2 — the frame (chasing 16.6 ms)

Sequenced *after* 0.1, because 0.1 says which of these is worth doing.

| # | Work | Working = | Not helping = |
|---|---|---|---|
| 2.1 | **Hardware scaling** lab at 1.0 / 1.25 / 1.5 / 2.0. | A setting exists that is under 16.6 ms and the user cannot tell it apart at the play camera | Every setting under 16.6 ms is visibly soft |
| 2.2 | **Purpose-written blade `ShaderMaterial`** vs PBR-with-subsurface, with **vertex-shader NDC culling** (forum 62558's approach). | ≥ 1.5 ms saved with the field looking the same or better | < 0.5 ms saved |
| 2.3 | **Translucency audit**: A/B `subSurface` off on the sward. | Off is not darker (it deletes 55% of diffuse irradiance) — and is cheaper | Off is visibly flatter |
| 2.4 | **Baked geometry vs thin instances** for one patch (forum 46756's 4× claim). | ≥ 2 ms saved at equal blade count | < 0.5 ms, or it breaks the compute placement |
| 2.5 | **Terrain pass**: whatever 0.1 attributes to it — chunk count, texture count, CSM sample cost. | — | — |

### Phase 3 — re-examine the refused list — closed 2026-09-13, as settings

All five were built and measured, and **none was refused**. MSAA ×2 +4.6 ms,
SSAO2 +8.4 / +26.9, god rays +4.6, grass shadows +8.3, and alpha-to-coverage
still has no multisampled scene pass to hang on. Every one that works is a switch
in the board's **graphics menu** with its price beside it, off to begin with.
`BOARD-PLAN.md` Phase 4 is the menu; `PLAN.md` carries what each one cost to get
right.

**Rule:** if a technique is standard in shipping games for this kind of scene and
the lab says it fails, assume the implementation is wrong, find the reference,
and diff against it before refusing. And a technique this machine cannot afford
is not refused — it is a setting, defaulted off.

---

## 6. Repo map for the board

```
projects/ooze/src/app/board/
  PLAN.md              rules, refused table, tooling traps
  FOLIAGE-REPORT.md    the scan/alpha research
  BOARD-HANDOFF.md     this file
  ground-field.ts      wear/wet/height field — the source of truth for placement
  species.ts           the sward's species table, SWARD_FADE, CardSpec
  bab/
    stage.ts           engine, scene, camera, sun, sky, CSM, TAA, grade, toggles
    effects.ts         SSAO2 with the sky mask, god rays, grass shadows
    meadow.ts          the sward: WGSL compute placement → thin instances → indirect draw
    blade-wind.ts      MaterialPluginBase WGSL injection: wind, per-plant shading
    foliage-cards.ts   cardGeometry(): cards/heads/stems from the cut-out sheet
    standing.ts        trees, scrub, stone, ground flora — scans, masks, placement
    terrain.ts         40 chunks + sward shadow proxy
    splat-bake.ts      board-wide macro colour/normal/ARM bake
    bab-board.ts       the Angular component: canvas, toggles, Assets panel
    plant-preview.ts   the Assets panel's own scene (top/three-quarter/low/side)
    stats.ts           the HUD counters
    gpu-passes.ts      per-pass GPU timing: every render target and compute pass
    split-frame.ts     the delta instrument — wall clock with one piece off
tools/                 board-check.sh, board-angles.mjs, chrome-probe.mjs,
                       board-shot.mjs, build-ok.sh, wgsl-lint.mjs,
                       foliage-pack.mjs, foliage-trim.mjs
```

### Standing behavioural rules (from the user, still in force)

- No time estimates. Rank by size and value.
- Never say "budget".
- **Do not say something is done — the user decides that.**
- American spelling in code (`color`).
- Verify with the full build, never `compile` alone.
- The whole board is the shot; standing-in-the-field numbers are not the target.
- No LOD that removes foliage from the map.
- This is an experimental, not-deployed branch. Breaking it is fine — never hedge
  about breakage.
- End every message with what is next.
