# What this renderer should be

Written after measuring the board properly for the first time, and revised
twice since — once when the measurement overturned what was slow, once when the
argument about engines was made honestly instead of defensively.

Verdicts:

| Question | Answer |
|---|---|
| What is actually slow? | **The terrain shader.** 93.5 ms to cover the screen. Everything else is a rounding error beside it. |
| Is the grass the problem? | No. 18.6 ms, and the most finished thing on the board. |
| Why did the coast, wood and pass feel worse? | Less grass hiding the terrain shader. (Their art is separately bad. That is a different problem.) |
| What is the fix? | **Bake the ground once.** Not a virtual texture — the board is 220 by 150 feet. |
| Which engine? | **Babylon.js 9**, on WebGPU. |
| Was `onBeforeCompile` a mistake? | Yes — and not mainly for maintainability. It hid what the shader cost. |
| How much custom code should there be? | **As little as possible.** Custom is only worth it where a player would notice. |

---

## 1. The measurement

The frame-rate counter cannot answer any of these questions. It is one number
for the whole frame, and in a pane that is not compositing it reads zero. These
come from `EXT_disjoint_timer_query_webgl2` — the GPU reporting its own elapsed
nanoseconds — via `BoardRenderer.probeCost()`.

Road board, whole board in view, 1404 × 726, Apple M5, 12.1 M triangles,
118 draws:

| What was drawn | ms | as a frame rate |
|---|---:|---:|
| Everything, effects on | 33.8 | 30 fps |
| Everything, effects off | 29.5 | 34 fps |
| Grass alone — 830 k plants, no ground | 18.6 | 54 fps |
| Grass + a ground with a stock material | 20.8 | 48 fps |
| **Ground alone, our splat shader** | **93.5** | **11 fps** |
| Ground alone, stock material | 28.0 | 36 fps |
| Ground alone, quarter resolution | 8.3 | — |
| Re-rendering the shadow map | 0.0 | already cached |
| Bloom | 11.5 | — |

### It is fill-bound, not geometry-bound

Quarter the pixels and the ground costs 8.3 ms instead of 93.5 — elevenfold for
a fourfold cut, because the texture cache starts working again too. The
triangles were nearly free. Fifty samplers, stochastic tiling at three taps per
layer, two `textureGrad` scale bands, at every pixel of every frame.

### The grass was hiding it, and my first explanation was wrong

Ground alone is 93.5 ms; ground plus 830,000 plants is 29.5 ms. Adding geometry
made the frame three times faster.

I reached for early-Z — grass draws first, writes depth, the ground's shader is
rejected. Testable, and wrong: forcing the ground to draw *first* with
`renderOrder = -10` changed nothing (29.8 against 30.2).

The real mechanism is that this is an Apple GPU. Tile-based deferred renderers
bin all geometry before shading anything, so occluded fragments are discarded
regardless of draw order. Which matters well beyond the curiosity: the saving is
hardware we do not control, immediate-mode GPUs get none of it, and **any view
with less grass in it pays the full 93 ms**.

---

## 2. The fix: bake the ground

The splat produces the same answer every frame. Nothing about it changes except
which part of it you can see. So compute it once, into a texture the size of the
board, and sample the texture.

**No virtual texturing, and none needed.** I had sized this problem as if it
were an open world — pages, a feedback pass, a residency scheduler. The road
board is 220 by 150 feet. At four texels to the half-foot the whole of it is
1760 × 1200: one texture, baked at load, re-baked over a rectangle when a brush
touches it.

The bake also makes the expensive shader *affordable*. Stochastic tiling at
three taps across three layers costs nothing if it is paid once — so the baked
version can be more careful than the per-frame one ever could be, not less.

What the bake cannot hold is near-field grain: at four texels to the half-foot a
blade of grass is a quarter of a texel. So one tiling photograph goes over the
top, blended in. Macro plus detail is what every terrain renderer does, and in
Babylon it is the `detailMap` plugin rather than code.

Then, in order: chunk and LOD the mesh (done — 40 chunks against one unculled
1,056,000-triangle mesh); move the plants to a compute pass with indirect draw,
which turns the density slider from a rebuild into a uniform; add the far band
that is not geometry; steal *Ghost of Tsushima*'s shadow trick, where grass does
not cast real shadows at all — the terrain vertices are raised to grass height
and depth is written in a dithered pattern.

---

## 3. The engine: Babylon.js 9

### The question I asked first, and it was the wrong one

I asked which engine had the better authoring model for our custom shaders. The
prior question is **how much custom code should exist at all**, and the answer
is: as little as possible. Custom is only worth it where a player would notice.
Nobody has ever enjoyed a game because its light accumulation was bespoke.

By that rule most of what this renderer contains was a mistake — not bad code,
but custom budget spent where it buys nothing.

| What was hand-written | Babylon 9 |
|---|---|
| Baked light field, ~530 lines with its tests | Clustered lighting — real point lights, real shadows |
| Crysis transmission approximation | `subSurface.isTranslucencyEnabled` + thickness |
| `EffectComposer` chain, grade pass, AO tuning | Frame graph + `ImageProcessingConfiguration` |
| Nothing — we did not have it | Volumetric lighting: torch shafts through trees |
| A hand-rolled GPU timer-query harness | Inspector v2 |
| Shadow-frustum fitting, camera plumbing, layer juggling | `CascadedShadowGenerator`, `ArcRotateCamera` |

Babylon 9 shipped in March 2026: clustered lighting, volumetric lighting via
compute, the frame graph promoted to v1, textured area lights, Inspector v2.

### Two corrections I owe the record

**I mischaracterised Babylon's extension model.** I said `MaterialPluginBase` is
string injection and you would author every shader twice. True of plugins, and
it ignores that Node Material covers PBR through `PBRMetallicRoughnessBlock` and
`SubSurfaceBlock` and compiles to both backends from one graph. That objection
was the load-bearing part of my argument against Babylon, and it was wrong.

**I nearly claimed clustered lighting as a Babylon-only win.** three has it too
(`ClusteredLighting`, 1024 point lights) — though three's excludes
shadow-casting point lights, which for a torchlit dungeon is exactly our case.

### What three.js would still have won on

TSL: typed TypeScript compiled once to WGSL or GLSL. It is a better shader
authoring model than anything Babylon has. It loses because it optimises the
wrong quantity — it makes writing custom shaders pleasant, when the goal is to
write fewer of them.

The migration cost is not part of this. The shader rewrite is a cost of the
*work*, not of the *choice*: WebGPU means rewriting every shader we have
whichever engine we land on.

### The one thing switching does not do

**It does not fix the 93 ms.** No engine ships a baked terrain or a vegetation
system. Port and stop, and we have a nicer codebase running at the same frame
rate. The bake is the work; Babylon is the place to do it.

---

## 4. What stays custom

The rule: **keep what computes a fact about the world, cut everything that
draws.**

| | Why nothing replaces it |
|---|---|
| `sun-position.ts` | No engine ships an almanac. Declination, hour angle, air mass. `SkyMaterial.useSunPosition` takes the vector it produces. |
| `ground-field.ts` | Wear, wetness, ruts, puddles as float fields. Board *content*, not rendering. |
| The level generators | The maps themselves. |
| The meadow's species model | Strip, Species, clump, Drift. The distinctive look, and nobody ships it. |
| `trees.ts`, `scatter.ts` | Procedural geometry and placement rules. Already engine-clean. |
| The terrain bake | Does not exist anywhere. |
| Compute scatter | Does not exist anywhere. |

At the start of the port, 6,091 lines named three and 6,168 did not. The seam
`board-scene.ts` was built for turned out to be real.

---

## 5. Where it stands

Done: the road board on Babylon 9.26 at `/ooze/board/bab`. WebGPU only — no
WebGL2 fallback, because every browser ships WebGPU, compute is the point of
the scatter that comes next, and one backend means one shader language.
The ground is baked and chunked; the sun, the ground field and the level data
moved across untouched.

Not yet verified visually: the board built and started once — 40 chunks in
38 ms, sky rendering, ground not drawing — and then the pane's GPU process
wedged, with `requestAdapter` timing out browser-wide in a fresh tab with no
Babylon involved. Two likely causes of the missing ground were fixed blind
against that one run: asset paths were being handed to Babylon unresolved (nginx
answers a miss with `index.html`, 200, `text/html`, so a texture loader gets a
web page and the surface stays blank), and the axis swap from our right-handed
Z-up board into Babylon's left-handed Y-up reverses triangle winding.

Next: measure the baked ground against the 93.5 ms it replaces. Then clustered
lighting in place of the light field, the meadow on a compute pass, and the
frame graph for the post chain.
