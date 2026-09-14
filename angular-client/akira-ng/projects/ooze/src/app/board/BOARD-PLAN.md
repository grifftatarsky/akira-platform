# The board: the list

The working checklist. `BOARD-HANDOFF.md` is the state and the research,
`PLAN.md` the rules, the refused table and the traps. This is what gets crossed
off.

Updated 2026-09-13. The same list is a page at
`projects/ooze/public/board-plan.html`, which ooze serves at **/board-plan.html**
on its own port and which is published as an Artifact for the Claude GUI —
https://claude.ai/code/artifact/a3019fb5-028c-4cd6-b34c-a22dad6b13f9

One file, two destinations: the page is published from the repo, so there is no
second copy to drift. **This markdown and that page move together** — when an
item changes here, change the `PHASES` block in the page and republish. Ticks on
the page live in its own store and survive a republish, so crossing something off
there is not undone by an update here.

**Where we are:** **47 fps at maximum plants — 21.5 ms** at the play camera,
**3600 x 2026 (7.29 MP)**, on a freshly started browser. Target is 60 (16.6 ms).
The order is **look first, then optimize** — Phase 1 before Phase 2.

**Next:** Phase 5 — `GRAPHICS.md` is the survey of what this renderer does and
what Babylon 9.26 still has. Batches A and B of it are in the menu (53 settings);
**C is FSR1**, the only thing that makes render scale good rather than merely
cheap, then D depth of field properly measured, E snapshot rendering, F IBL
shadows, G depth peeling.

Phases 2 and 3 are closed. Everything they measured is a switch in the
board's **graphics menu** with its price beside it, and **2.2 is the one that
gives a frame back** — a grass shader written for the grass, 3.2 ms returned,
in the menu as *fast grass*. **2.1** is in the menu as *render scale*, measured
across its five steps, and wants your eye rather than another number. What is
open: whether any of these should be on by default, where render scale starts to
look soft, and `shadowProxy`'s 200k threshold, which still misses all three
searsia parts so the scrub casts at full resolution.

> **A frame number without its pixel count and its browser's age is not a
> measurement.** The audit found both mattering more than anything in the
> renderer: the same board read 23.9 ms on a Chrome that had been reloading
> WebGPU contexts all session and 21.5 ms on a fresh one, and the sward alone
> read 8.57 ms against 4.88. And a probe window that lands on a non-Retina
> display quietly quarters the pixel count — one run came back at exactly
> 16.67 ms with every component at zero, which is the 60 Hz refresh, not a fast
> board. Restart the browser, pin `setHardwareScalingLevel`, and read the render
> size off the HUD before believing anything.

---

## Phase 0 — instruments and regressions

| | Work | State |
|---|---|---|
| 0.1 | Per-pass GPU breakdown | **done** — and it found the 8.1 ms baseline was an instrument fault, not a cost |
| 0.2 | Bald ring: one shared wear fade | **done** — coverage map has no thin cell off the track |
| 0.3 | Absolute density; `MAX_PLANTS` a cap | **done**, with the criterion corrected — see below |
| 0.4 | Lab harness: `/board/lab` + one worked screen | **done** — index, shell, A/B switch, wall clock, pixel diff with a control |

### What the audit changed

Phase 0 was audited on 2026-09-12 and three of its claims did not survive.

- **The frame was overstated.** 22.9 ms / 45 fps was one reading at the fast end
  of the distribution. Repeated, the board is **23.9 ms / 42 fps**.
- **The density slider did not thin uniformly.** Grass, clover and plantain
  scaled exactly, but Yorkshire fog came back at 61% of itself at half density
  instead of 50%: its slots per cell were rounded down, so `keep x crowd`
  exceeded one and its lottery *saturated* at full density. Slots are now
  rounded up, and every species measures 0.498–0.502 at half and 0.249–0.252 at
  a quarter.
- **"Adding or removing a species changes only that species' count" was too
  strong.** The *allocation* is decoupled exactly — remove clover and every other
  species' slots, cap, keep and the lattice itself are bit-identical, which the
  unit test asserts. The *drift lottery* is deliberately coupled, because a
  species' share of a spot depends on what else wants it, and measured that is
  worth up to 21% (grass +0.7%, fog +2.2%, plantain +20.6% when clover is
  removed). The criterion is now about allocation, which is what was fixed.

Two instruments were repaired at the same time:

- `splitFrame` took one baseline and compared thirteen readings to it over
  thirteen seconds. On a machine whose load moved, every component inflated —
  one run had the parts summing to 73.6 ms of a 28.7 ms frame. Each slice is now
  bracketed between the on-readings either side of it, and the run reports its
  own **drift** so a reading taken on a busy machine says so.
- The **sky dome** was drawn but not switchable, so it sat in `unattributed`. It
  has its own toggle now, and `unattributed` is 0.00.

Phase 0 is closed.

---

## Phase 1 — the grass itself

The user's main complaint, and the reason the order is look-first. Every item
gets a lab screen before it touches the meadow.

| | Work | Working = | Not helping = | State |
|---|---|---|---|---|
| 1.1 | **Blade mesh** — quadratic-Bézier blade, `2·stacks+1` verts, tapered to a tip, **±0.3π rotated normals**. Lab it against the current card, side by side | No visible repetition at the play camera; blades read as rounded, not as flat strips | > 1.0 ms over cards at equal density | **removed from the code 2026-09-13.** Closed on cost, then deleted: `blade-geometry.ts`, `lab/blade.ts` and its lab entry are gone |
| 1.1b | **The twist on the card** — the reference's ±0.3π normal rotation on the existing geometry | The sward reads as cupped rather than flat; a tuft has a lit and a shaded side at once | Any measurable cost, or the user cannot see it | **taken 2026-09-13 — it is the sward now, and the only one.** Chosen on the board, not in the lab: about 5 fps over cards and far more over blades, and the blade no longer had the fidelity to justify itself. `EDGE_FAN` is `tan(0.3π)` in `foliage-cards.ts`, so every card the board draws is twisted; the card/blade switch, `grown`, `setShape` and the `LeafShape` override are gone |
| 1.1c | **The card's dark bar** — one strand in one cut, landing on every plant | No repeated letterform in the sward | — | **done 2026-09-12** — spray cut 0's fat diagonal leaf, drawn by all three cards. Grass is five `blade` cuts plus one spray now; coverage 4.6→10.9‰, swing 3.2×→1.38× |
| 1.1d | **The leaf-normal blend** — `blade-wind.ts` shades the sward `mix(leafNormal, groundNormal, 0.9)`, so nine tenths of every blade is lit by the terrain. It is a **Leaf normal** slider now. Lowering it is what lets 1.1b, 1.3's per-blade colour, and any future normal work reach the screen | Blades in one clump are lit differently from each other; the field shimmers as the sun moves | The sward loses its even mass, or reads noisy at the play camera | **decision open** — at 45% the card/twist switch goes from 0.78 to 5.35 mean difference, and 8am contrast from 37.2 to 46.4. Free |
| 1.1e | **The sward's coverage** — you see ground through cards and not through blades. Not width: an upright quad seen from above is a line, so five near-vertical cards leave gaps a solid blade does not | No holes through the sward at a steep camera | Costs more than the blade it is replacing | **done 2026-09-13** — lean 0.34→0.90 and 5→9 cards a plant. Holes in a steep view 5.6%→1.8% against the blade's 1.2%, at 31.9 ms against the blade's ~50 |
| 1.1f | **The wind cannot be seen** — it runs at `0.62 * stiff`, under half the plugin's own 1.35 default, and moves the sward about 7/255 over three seconds | Gusts are legible as wind without looking at a graph | — | **slider added 2026-09-13, resting value open.** 250% is plainly visible. The shape of the gust is 1.2's job |
| 1.2 | **The old wind back** — front with lulls, three-wave body phased on crosswind, per-plant fast term | Gusts cross the field as patches with visible lulls; no plane-wave carpet; reads as flow from above | > 0.3 ms (it is vertex-only) | **done 2026-09-13 — free.** 31.0 ms still against 30.8 blowing. A travelling *pattern*, not travelling waves: the field is sampled at `root.xz - downwind * t`, so the gusts move downwind together instead of each sine running along its own axis. Lulls are a `smoothstep` that reaches zero, and a per-plant flutter rides on the local gust. 2.2× the motion of the old wind at the same slider. `patchSize` and `gustBias` are live on the plugin |
| 1.3 | **Blade variety** — per-instance hue/height/width/curve/tilt from the clump hash; base→tip colour with a mix factor; AO at the root | Two neighbouring tufts are never obviously the same object | > 0.3 ms | **done 2026-09-13 — most of it already existed.** Hue, curve, azimuth, root AO and the base→tip ramp were all in. The one thing missing was that `tall` and `wide` were the same scalar, so every plant was a *uniform* scale of one mesh. Height over width now runs 0.72–1.34 across the field, measured off the matrix buffer, where it was exactly 1.000 for all 230,000 |
| 1.4 | **Mixed sward structure** — trodden patches, mown verge, taller unmown drifts | The field has places rather than one texture | — | **done 2026-09-13 — free, and slightly cheaper.** Two octaves of value noise give a `stature` field: drifts run 0.56 to 1.42 of normal height, and the grass shortens by up to half as `wear` climbs toward the track, so the verge is trodden rather than simply absent. Density follows stature gently, 0.80 to 1.10. 29.8 ms at the play camera against 31.9 before |
| 1.5 | **Scanned flora reads pale and scattered** (was regression 2c) — colour dilation under the mask, more than one noise octave for drift, and the translucency finding below | Flora sits *in* the sward, not on top of it; leaf rims do not drift toward the atlas black with distance | — | **done 2026-09-13, with one part refused to the asset.** Dilation was already in the packer (0748ad4). Drift is three octaves now; flora beds 22% of its height into the sward instead of 6% and takes a small lean and roll. Translucency is off everywhere — 2.3's finding, applied. **The paleness is the scan.** The rosette cut-outs are genuinely pale yellow-green; a `wash` on the species takes 21% of the pale area out and no more, because the leaf is blown out by direct sun rather than by its albedo. Raising its ground blend makes it *worse*. A darker source cut belongs in `foliage-pack.mjs` |

---

## Phase 2 — the frame

Sequenced after Phase 1. 0.1 already says which of these is worth doing. The
frame at the play camera, three bracketed runs averaged on a fresh browser at
7.29 MP, drift 0.37 ms:

| piece | ms | | piece | ms |
|---|---|---|---|---|
| **whole frame** | **21.5** | | stone | 0.28 |
| trees and scrub | 4.93 | | ground relief | 0.18 |
| sward | 4.88 | | sky dome | 0.13 |
| shadows | 4.03 | | grade | 0.08 |
| terrain | 2.13 | | **unattributed** | **1.22** |
| ground flora | 1.87 | | | |
| temporal aa | 1.42 | | | |

**Trees and scrub is now the largest piece**, a hair above the sward. On the
worn browser the sward measured 8.57 and looked like the whole problem; it is
not.

Taking a group away also removes whatever it was occluding, so this is a
difference measurement, not a partition.

| | Work | Working = | Not helping = | State |
|---|---|---|---|---|
| 2.1 | **Hardware scaling** | A setting under 16.6 ms the user cannot tell apart at the play camera | Every setting under 16.6 ms is visibly soft | **in the menu 2026-09-13 as *render scale*, five steps, measured.** 7.29 MP → 27.9 ms · 5.27 → 25.3 · 4.10 → 23.1 · 2.62 → 20.9 · 1.82 → 19.1. **Not linear in pixels:** a quarter of the pixels buys 31% of the frame, because the vertex work, the culling and the shadow map do not scale with resolution. 1:1 crops say 75% is close to indistinguishable and 50% is visibly mushy — but that call is the user's |
| 2.2 | **Purpose-written grass `ShaderMaterial`** vs PBR | ≥ 1.5 ms saved, field looks the same or better | < 0.5 ms saved | **passed 2026-09-13 — 3.2 ms back, and it is in the menu as *fast grass*.** `grass-fast.ts`: one texture read, an alpha test, a sun, a bounce, a hemisphere and one GGX highlight, with the wind and the shading blend carried over verbatim from the plugin. 27.9 ms → 24.5/25.0 matched, 24.0/24.4 with the sheen dropped. The old 2.0 ms ceiling was measured as *unlit PBR*, which keeps PBR's vertex shader — and about 40M vertex invocations a frame on the grass is where most of the saving is. NDC culling untried and probably pointless: compaction already removed 52% of instances for no gain. It cannot receive the shadow map, so it and grass shadows turn each other off |
| 2.3 | **Translucency audit** | Off is not darker | Off is visibly flatter | **done — refused.** Lab says on costs 0.4 ms *and* is flatly darker. Turning it off on the board is the next board change |
| 2.4 | **Baked geometry vs thin instances** for one patch (forum 46756's 4× claim) | ≥ 2 ms saved at equal blade count | < 0.5 ms, or it breaks the compute placement | **refused 2026-09-13 — baking is 18% *slower*.** 112,543 grass plants, coverage matched to 0.1% of the view, empty-scene baseline subtracted: instanced **6.5 ms**, baked **7.65**. The forum's 4× does not reproduce here. Baking also costs 9.45M vertices and 86 MB of index buffer against an 84-vertex mesh, and gives up the wind, the ground-normal shading, the per-plant tint and the compute placement, all of which read the instance matrix |
| 2.5 | **Trees and scrub** — 4.93 ms, the *largest* piece and never examined | No visible difference at the play camera | < 2 ms saved | **closed 2026-09-13 — refused to the asset.** 4.2 ms split 3.6 camera / 1.1 shadow. Not fill (2.4 ms survives at a camera where the board is 3.75% of the view; they draw 0.4% of the screen). Not the material (one-sided, culled: nothing; `freeze()` is 2.4 ms *worse*). Only half is triangle count — thinning 7× recovers 1.9 of 3.6 — **and it strips the trees bare**, because on a photogrammetry canopy the leaves *are* the triangles. `island_tree_02` is trunk 27,298 + leaves 714,744 + branches 330,171, one LOD0 node, for a 3.4 m plant. Open and untested: `shadowProxy`'s 200k threshold misses all three searsia parts, so the scrub still casts at full resolution |
| 2.6 | **Shadows** — 4.03 ms for two cascades at 2048 | — | — | **done 2026-09-13 — the proxy is wired in.** `shadowProxy()` in `standing.ts` decimates any caster over 200k triangles: every triangle in the top 3% by area, plus a hashed 30% of the rest, on a shadow-only layer mask. The board's caster count went **4.93M → 2.75M** triangles; `scan-island_tree_02-0` casts 344,691 instead of 1,072,213, across all three of its instances. It refuses and returns null if the instance count does not match, because a proxy that casts nothing reads like a win |

---

## Phase 3 — re-examine the refused list

Each in its own lab. **Rule:** if a technique is standard in shipping games for
this kind of scene and the lab says it fails, assume the implementation is
wrong, find the reference, and diff against it before refusing. Refusing an
industry standard needs a citation for why this renderer is the exception.

**Nothing here is refused.** Every one of them works; every one costs more than
this machine can spare at maximum plants; all five are switches in the board's
graphics menu, off to begin with, for whoever is running a card that can afford
them.

| | Work | State |
|---|---|---|
| 3.1 | `taa.msaaSamples` above 1 | **a setting — `+4.6 ms`.** Earlier read 9.4 ms at a different framing; at the play camera over a 28.1 ms frame it is 4.6. Four samples cost no more than two, so the price is the multisampled target, not the resolve. **The mechanism is not scene MSAA:** it sets the sample count on the *TAA post-process's* target, so with TAA off it does nothing at all — samples 1, 2 and 4 give a byte-identical frame. What it buys is edge 17.96→17.66 and crawl 0.962→0.696 |
| 3.2 | Alpha-to-coverage, once `sampleCount > 1` | **not taken — no multisampled target to hang it on.** `engine.setAlphaToCoverage(true)` exists on the WebGPU engine, but 3.1 established that the scene pass stays at one sample whatever `msaaSamples` says. A2C needs the *scene's* pass multisampled, and nothing on this board multisamples it |
| 3.3 | SSAO2 with the sky mask (forum 63942) and an explicit render list on the prepass | **a setting — `+8.4 ms` ground only, `+26.9 ms` with the grass.** The forum's NaN is real and is now patched in the WGSL at the shader store: the prepass normal is `(0,0,0)` on the sky and `normalize()` of that is NaN, so the shader carries a `skyMask` and a guarded normalize. **The `excludedMeshes` half is answered too, and it is the whole cost:** the grass in that buffer is 18.5 of the 26.9 ms. But leaving the grass out takes nearly all of what you can see with it — the grass covers the ground being darkened — so which meshes feed it is a select in the menu, not a decision |
| 3.4 | Grass receiving shadows via a lifted proxy | **a setting — `+8.3 ms`.** The acne was never the depth bias. It was the lifted proxy, which stands at grass height and therefore shadows every blade underneath it; left casting, the whole field goes dark. Dropped from the casters while the grass receives, the field takes tree shadows cleanly and gives up its own shadow on the road. That trade is the second select in the menu |
| 3.5 | God rays with a real sun quad | **a setting — `+4.6 ms`.** A billboarded disc on a hidden layer at 3000 half-feet along the sun, with the occluder pass given an explicit render list of the disc, the terrain, the trees and the stone. That render list is the difference from the attempt that flooded white and cost 7 ms doing nothing: the sky box was standing in for the light, and a sky is not an object. Worth having at a low sun; at noon there is nothing in front of the sun to throw a shaft |

---

## Phase 4 — the graphics menu

Built 2026-09-13, because a frame this machine cannot spare is not the same as a
frame nobody can. Everything Phase 3 measured is a switch in the tools panel with
its price beside it, persisted per browser, and **only temporal aa is on to begin
with**.

Superseded 2026-09-13 by **Phase 5**: the menu is now 53 settings in six banks,
built from a declarative table in `graphics.ts`. The switches below are the ones
with a measured price; the rest are dials and picks on things the board used to
hardcode. See `GRAPHICS.md`.

| switch | cost | sub-choice |
|---|---|---|
| temporal aa | +1.8 ms | — |
| msaa ×2 | +4.6 ms | needs temporal aa on |
| ambient occlusion | +8.4 / +26.9 ms | *reads*: ground only · grass too |
| god rays | +4.6 ms | — |
| grass shadows | +8.3 ms | *casts*: trees and stone · everything |
| **fast grass** | **−3.2 ms** | *lit*: matched · no sheen |
| bloom | +1.6 ms | — |
| render scale | 27.9 → 19.1 ms | 100 / 85 / 75 / 60 / 50% |

Measured at 3600 × 2026, play camera, noon, wind stopped, over a 28.1 ms frame,
two passes each, on a freshly started browser. **`split frame` now measures
whichever of these are on**, so the numbers above are one machine's reading and
not the answer.

`effects.ts` holds SSAO2, the god rays and the grass-shadow wiring;
`grass-fast.ts` holds the grass shader; `stage.ts` gained `setMsaa` and
`setRenderScale`; `taa` and `bloom` moved out of the *show* row, which is for
content, into the menu, which is for quality.

---

## The lab

`/board/lab` lists every screen. One technique each, on the smallest scene that
exercises it, with the criterion written **before** the demo was built.

| screen | phase | result |
|---|---|---|
| `blade` | 1.1 | refused 2026-09-12 on cost — 21.0 ms against 47.1 on the board. The look objection in the first result was a bug in my blade, not the technique |
| `translucency` | 2.3 | refused 2026-09-12 — 10.1 on / 9.7 off, and on is darker |

### 1.1 and 1.1b, worked through

Three things were asked for and all three were run to the end: kill the bar in
the card, settle the twist, and compare card against blade at matched cost.

#### (a) The card's bar — gone, and the card rebuilt

The bar is a real strand in **spray cut 0**: a short fat dark diagonal leaf in
its lower left. With two spray cuts over three cards it landed twice on every
plant — and `cuts[(n + placed * 3) % 2]` is 0 for n = 0,1,2, so in fact all three
cards drew it.

The sheet already held better material. The **`blade` group is seven distinct,
clean, full-height single blades** with midribs, fine tips and real colour
variation, at 35–60% fill against the sprays' ~4%. Grass is five of those plus
one spray for the arch. Cuts cycle on the leaf index; each card takes its own
lean from the golden ratio so five blades splay instead of standing in a bundle.

| | per-angle coverage (‰) | swing | mean |
|---|---|---|---|
| as it was | 2.7 · 4.2 · 6.5 · 4.2 · 2.1 · 4.9 · 6.6 · 5.7 | 3.2× | 4.6 |
| rebuilt | 9.6 · 10.5 · 11.9 · 9.1 · 12.4 · 11.9 · 12.6 · 9.2 | **1.38×** | **10.9** |

20 triangles to 40. Play camera about 21 ms to 27.

#### (b) The twist is inert, and why is worth more than the twist

**Card and twist are the same mesh.** Same vertices, same triangles, same
texture, same draw, same cost. `addCard` writes each edge vertex's normal as
`face + across * fan`: the card's `fan` is `EDGE_FAN` 0.3, so its edge normals
tilt 16.7° outward; the twist's is `tan(0.3π)`, so they tilt 54°. The card
claims to be a very shallow cylinder, the twist a nearly half-round tube.
Nothing moves. It is entirely a lie told to the lighting.


Card against twist, one tuft, eight angles, pixel diff per channel out of 255:
**0.06–0.10 at the shipping settings.** Across midday, 9am, 7am and 6am, the
same. The normals are not the problem — they differ by 37° mean, measured off
the VertexData.

**`blade-wind.ts` discards them.** The shading normal is
`mix(leafNormal, groundNormal, plant.lit)` and `lit` is 0.9 for grass, so ninety
per cent of the sward's shading is the terrain's normal. A 37° change to a leaf
becomes under four degrees on screen. **No per-blade normal work can show while
that stands.**

The lever is that blend. At 0.45 of its shipped value, an 8am sun takes the
sward's shading contrast from 37.2 to 46.4 — a quarter more — and the field gains
a per-blade shimmer. At midday it is a wash, because a high sun reads mostly the
normal's Y and `lift()` pins that. It is a **Leaf normal** slider in the tools
panel now, at 100% as it ships.

#### (c) Card against blade, and the blade now has a texture

At matched cost the first comparison went to the card easily, because the blade
had **no texture at all** — a flat albedo off the species table. It could not be
textured from the cut-out atlas: the sprays' interiors are the transparent gaps
between blades, which the alpha test turns into holes, and making the material
opaque sampled the atlas's black background instead.

The `blade` group cuts are single opaque strands, so a photographed blade maps
straight onto the generated geometry — geometry edges to the cut's own silhouette
edges at each height, holding off the top 12% where the scan is a hair. The blade
tuft has midribs, yellowing and colour variation now.

| | triangles | play camera | fill rate |
|---|---|---|---|
| card @100% | 90 | 26.8 ms | 1.68 ms/MP |
| blade @100% | 162 | 50.1 ms | **3.38 ms/MP** |
| blade @38% | 162 | 33.0 ms | |

**The blade is not geometry-bound.** Cutting blades-per-card from five to two —
638 triangles to 162 — moved the frame 52.4 to 49.4. The cost is fill, and it is
fill because the blade *draws more grass*: solid geometry with nothing discarded,
against a card that is mostly empty quad. That is the whole trade.

Both are on the board's **sward** switch. Neither is refused; both are yours to
call.

### What this cost, as a lesson

Two refusals were published from screenshots taken at 300 half-feet. At that
distance a tuft is four pixels and a broken tuft is also four pixels. **Look at
one of the thing before judging a field of them** — the lab has a route for it
now.

## Standing rules

- **Nothing gets refused. Anything that works becomes a setting.** A technique
  that costs more than this machine can spare is not a technique that nobody
  wants — it goes in the graphics menu with its measured price, off by default if
  the cost matters. Measure it, show it, ship the switch, and let the user
  decide. "Refused" is theirs to say, not mine — and the blade is why: it was
  refused twice on a look that was my own bug.
- **One subpoint at a time**, and wait for a yes or no on it before starting the
  next.
- No time estimates. Rank by size and value.
- Never say "budget".
- Do not say something is done — the user decides that.
- American spelling in code.
- Verify with the full build, never `compile` alone.
- The whole board is the shot; standing-in-the-field numbers are not the target.
- No LOD that removes foliage from the map.
- Experimental branch. Breaking it is fine — never hedge about breakage.
- No subagents. Not once.
- No comments in code; what was tried and failed goes in `PLAN.md`.
- End every message with what is next.


---

## Phase 5 — every setting exposed

`GRAPHICS.md` is the document: what the meadow draws pass by pass, every knob
the board already has, every constant it hardcodes that could be one, and what
Babylon 9.26 has that this board does not use — each checked against
`node_modules` and cited by path.

| | Work | State |
|---|---|---|
| 5.1 | **The capability document** | **done 2026-09-13** — `GRAPHICS.md` |
| 5.2 | **Batch A, the free grade** — tone mapping choice, exposure, contrast, vignette, white balance, dither, grain, sharpen, chromatic aberration, fxaa, glow | **done** — none of it is a new pass over the geometry |
| 5.3 | **Batch B, the knobs that already existed** — shadow map size, cascades, filter, filter quality, cascade blend, darkness, depth-fitted cascades, taa samples and blend, bloom's four numbers, fog, relief, anisotropy, leaf cut-out, leaf roughness, sky light | **done** — no new Babylon surface at all. **One is broken:** pcf at low quality emits invalid WGSL on 9.26 (`computeShadowWithCSMPCF1` called with an empty argument), guarded to medium, and the control says so |
| 5.4 | **Batch C — FSR1** (`fsr1RenderingPipeline`: `scaleFactor`, `sharpnessStops`) | **not started.** The one item that makes a bad setting good: render scale is bilinear today and 50% is visibly mushy |
| 5.5 | **Batch D — depth of field measured** | in the menu, unmeasured. It wants a depth pass; measure that once and camera motion blur becomes cheap too |
| 5.6 | **Batch E — snapshot rendering** (`engine.snapshotRendering`, WebGPU only) | **not started.** Possibly the largest win left, and the most likely to break the indirect grass |
| 5.7 | **Batch F — IBL shadows** (`Rendering/IBLShadows`) | **not started.** Sky occlusion done properly rather than approximated in screen space. Open question: can the voxeliser be given the terrain and trees only, the way SSAO's g-buffer was |
| 5.8 | **Batch G — depth peeling** (`Rendering/depthPeelingRenderer`) | **not started.** The only thing here that would change how the foliage *looks* rather than how fast it runs — alpha-blended leaves instead of the cut-out crunch |

### The instrument this needed

A `console.warn` wrapper installed **in the page** sees none of WebGPU's
validation errors and reported all 53 settings clean. They reach the **CDP**
console and not the page's console object. The sweep marks each knob with a
`console.log` and attributes faults from the raw CDP stream between marks;
`chrome-probe.mjs` has `RAW_LOGS` for that. Without it, `pcf` + low quality
would have shipped, because the board keeps drawing while one material's
pipeline is invalid.
