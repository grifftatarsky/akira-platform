# The board: handoff

**Read this first if you are a new instance working on the Babylon board.**
Then [PLAN.md](./PLAN.md) for the rules and the refused table, and
[FOLIAGE-REPORT.md](./FOLIAGE-REPORT.md) for the scan/alpha research.

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
| Is the served bundle current? | `tools/build-ok.sh <serve.log>` |
| WGSL + Angular-template lint | `node tools/wgsl-lint.mjs projects/ooze/src/app/board/bab/*.ts` |
| Tests (126) | `npx ng test ooze --watch=false` |
| Full frontend build | `PATH="$PWD/node_modules/.bin:$PATH" ./devbuildall.sh` |

`PATH` needs `/usr/bin:/bin:/opt/homebrew/bin` prepended in Bash calls here, and
`ng` is only on `node_modules/.bin`.

A real Chrome with CDP must be running for any probe:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9333 --user-data-dir=/tmp/chrome-probe \
  --enable-dawn-features=allow_unsafe_apis --no-first-run \
  --window-size=1500,950 about:blank &
```
The dawn flag is what makes WebGPU timestamps work (§3).

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

Skills exist for this: `.claude/skills/board-measure`, `foliage-scan`,
`graphics-lab`.

---

## 1. Where the board actually is

| | |
|---|---|
| Frame, whole board, wall clock | **18.3 ms** |
| Frame, play camera (beta 1.02, r 300) | **19.4–21.4 ms** |
| Frame, grazing (beta 1.46) | 22.0 ms |
| Frame, standing in the field (r 26) | 15.6 ms |
| Target | 16.6 ms (60 fps) |

**Every frame number quoted in this repo before 2026-09-12 was wrong** —
`board-check.sh` read `gpuTimeInFrameForMainPass`, which the Babylon d.ts
explicitly says "will only return time spent in the main pass, not additional
render target / compute passes (if any)"
(`Engines/thinWebGPUEngine.d.ts:51-54`). With a post chain installed that main
pass is one full-screen blit. It reported ~9 ms against a true 18. The tool
reads wall clock now.

Component cost at the play camera, by switching each off:

| piece | ms |
|---|---|
| sward (grass + fog + clover + plantain cards) | 4.3 |
| trees and scrub (scans) | 3.2 |
| ground flora (scans) | 1.9 |
| shadows | 1.9 |
| stone | ~0 |
| **unattributed baseline** | **~8.1** |

That baseline is the largest single number on the board and **nothing has ever
been measured against it**. It contains: the 40-chunk PBR terrain, the sky, the
TAA resolve, the grade post pass, and the present.

---

## 2. Open regressions (fix these first)

### 2a. The bald ring is a threshold disagreement — one-line fix, exact

Two systems disagree about where grass stops:

- `bab/meadow.ts:305` — `alive = 1 - smoothstep(wearMax - 0.2, wearMax, wear)`,
  and grass's `wearMax` is 0.62. **Grass geometry fades out over wear
  0.42 → 0.62.**
- `bab/splat-bake.ts:175` — `covered = (1 - smoothstep(0.40, 0.82, wear))`.
  **The ground paints grass until 0.82.**
- `bab/terrain.ts:214` — the sward shadow proxy uses the same
  `smoothTo(wear, 0.40, 0.82)`. **The grass shadow exists until 0.82.**

So the band **wear ∈ [0.62, 0.82]** is painted green, casts a grass shadow, and
has no grass in it. That is a ring ten to twenty feet wide around every stretch
of track, and where the track forks the ring sits mid-meadow — which is the
patch in the user's screenshot.

Verified by reading the compute pass's instance matrices onto a 44 × 30 grid and
overlaying the wear field sampled on the same grid; the empty cells and the
high-wear cells coincide. The band is present with 2 species and with 4, so it
is not the species mix.

**Fix:** one shared constant for the sward's fade, matching the bake's
`(0.40, 0.82)`. Do not "tune" `wearMax` per species until the two curves come
from one place.

### 2b. "100% grass" does not mean maximum grass

`MAX_PLANTS = 340_000` is a *total* split by each species' share **normalised by
the sum of the shares**, and the lattice pitch is derived from the *rarest*
share (`bab/meadow.ts:598-603`). So the mix and the density are coupled, and
removing species inflates the survivors. Measured and reproduced arithmetically:

| | sum(share) | pitch | cells | grass cap | grass placed |
|---|---|---|---|---|---|
| 2 species (grass, fog) | 0.48 | 1.76 | 42,750 | 299,250 | 92,098 |
| 4 species (+ clover, plantain) | 0.90 | 2.41 | 22,875 | 160,125 | **46,419** |

Deleting clover and plantain (commit `e250c1d`) handed their slots to grass;
restoring them (commit `b447c1d`) took them back and **halved the grass**. Both
are "correct" for a fixed total, and both are wrong for what the user asked:
*maximum grass should be the default when the meadow opens.*

**Fix:** give each species an **absolute density** (plants per square foot),
make `MAX_PLANTS` a safety cap rather than the budget, and derive the lattice
pitch from the densest species rather than the rarest. The ecology numbers for
real per-m² densities are in §4d.

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

## 3. Measure the 8 ms — the instrument already exists and was half-read

The board **already** requests the feature and enables the counters:

- `bab/stage.ts:488` — `deviceDescriptor: { requiredFeatures: ['timestamp-query'] }`
- `bab/stage.ts:496` — `engine.enableGPUTimingMeasurements = true`

And `bab/stats.ts:105-113` already reads the *right kind* of counter for the
shadow map:
`(texture.renderTarget as { gpuTimeInFrame }).gpuTimeInFrame.counter.lastSecAverage`.

**Every render target exposes this**
(`Engines/WebGPU/webgpuRenderTargetWrapper.d.ts:22-25`: "Gets the GPU time spent
rendering this render target in the last frame (in nanoseconds)"). So a true
per-pass breakdown is available today by walking
`scene.customRenderTargets`, the TAA pipeline's internal targets, each
post-process's `inputTexture`, the shadow generator's map and the reflection
probe, and reading each one's `gpuTimeInFrame`. Nobody has done it. Do this
before optimising anything.

Chrome needs `--enable-dawn-features=allow_unsafe_apis` (forum 53519,
Evgeni_Popov) — the HUD's non-zero `gpu` numbers confirm the probe Chrome has
it. `enableAllFeatures: true` is an alternative to naming the feature; the board
names it, which is better.

**Snapshot rendering will not help.** Babylon's own doc: "the performance
improvement is on the JavaScript side only: GPU performance will be more or less
the same" (`webGPUSnapshotRendering.md`). This board is GPU-bound.

**Resolution is the untested lever.** `adaptToDeviceRatio: true` renders at 2×
DPR — 5.7 MP. `engine.setHardwareScalingLevel(n)` divides that. Nothing in this
repo has ever measured 1.25× or 1.5×, and the meadow was measured as dead linear
in pixels at 1.25 ms/MP. **Unverified** how it looks; it is the cheapest large
experiment available.

---

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
merely lenient. The fix is a geometry mask using the prepass normal's alpha. So
the project's "SSAO floods the image" symptom was a real bug with a real fix; the
"+10 ms for the geometry prepass over 200k instances" half of the refusal is
still the load-bearing objection, and that one is about `excludedMeshes` on the
prepass — **untested**.

---

## 5. The plan

Ordered by (value ÷ risk). **Every item gets a lab screen before it touches the
meadow** — see `.claude/skills/graphics-lab`. A lab screen is its own route with
an A/B switch, its own on-screen wall-clock measurement, and a pass/fail
criterion written *before* it is built.

### Phase 0 — instruments and regressions (no new rendering)

| # | Work | Working = | Not helping = |
|---|---|---|---|
| 0.1 | **Per-pass GPU breakdown.** Walk every render target and read `gpuTimeInFrame`. Add to the HUD and to `board-angles.mjs`. | The 8.1 ms baseline is attributed to named passes, summing to within 1 ms of wall clock | — |
| 0.2 | **Bald ring.** One shared wear-fade constant across `meadow.ts`, `splat-bake.ts`, `terrain.ts`. | Matrix-readback coverage map has no cell under 20% of max outside the track itself | — |
| 0.3 | **Absolute density.** Species get plants/ft²; pitch from the densest species; `MAX_PLANTS` becomes a cap. | Adding or removing a species changes only that species' count | Frame cost rises more than the added plants explain |
| 0.4 | **Lab harness.** `/board/lab` index + one worked example screen. | A criterion can be read and judged without reading code | — |

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

### Phase 3 — re-examine the refused list, each in its own lab

`pipeline.samples = 2` MSAA (§4f) · alpha-to-coverage once sampleCount > 1 ·
SSAO2 with the sky mask and `excludedMeshes` on the prepass (§4g) · grass
receiving shadows via a lifted proxy · god rays with a real sun quad.

**Rule:** if a technique is standard in shipping games for this kind of scene and
the lab says it fails, assume the implementation is wrong, find the reference,
and diff against it before refusing. Refusing an industry standard needs a
citation for why this renderer is the exception.

---

## 6. Repo map for the board

```
projects/ooze/src/app/board/
  PLAN.md              rules, refused table, tooling traps
  FOLIAGE-REPORT.md    the scan/alpha research
  BOARD-HANDOFF.md     this file
  ground-field.ts      wear/wet/height field — the source of truth for placement
  species.ts           the sward's species table + CardSpec
  bab/
    stage.ts           engine, scene, camera, sun, sky, CSM, TAA, grade, toggles
    meadow.ts          the sward: WGSL compute placement → thin instances → indirect draw
    blade-wind.ts      MaterialPluginBase WGSL injection: wind, per-plant shading
    foliage-cards.ts   cardGeometry(): cards/heads/stems from the cut-out sheet
    standing.ts        trees, scrub, stone, ground flora — scans, masks, placement
    terrain.ts         40 chunks + sward shadow proxy
    splat-bake.ts      board-wide macro colour/normal/ARM bake
    bab-board.ts       the Angular component: canvas, toggles, Assets panel
    plant-preview.ts   the Assets panel's own scene (top/three-quarter/low/side)
    stats.ts           the HUD counters
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
