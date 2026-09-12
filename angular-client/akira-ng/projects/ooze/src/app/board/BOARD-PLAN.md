# The board: the list

The working checklist. `BOARD-HANDOFF.md` is the state and the research,
`PLAN.md` the rules, the refused table and the traps. This is what gets crossed
off.

Updated 2026-09-12. The same list is a page at
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
| 1.1 | **Blade mesh** — quadratic-Bézier blade, `2·stacks+1` verts, tapered to a tip, **±0.3π rotated normals**. Lab it against the current card, side by side | No visible repetition at the play camera; blades read as rounded, not as flat strips | > 1.0 ms over cards at equal density | **done — refused on cost, one free win taken.** See below |
| 1.1b | **The twist on the card** — the reference's ±0.3π normal rotation on the existing geometry, which is what the blade's shading half amounts to | The sward reads as cupped rather than flat; a tuft has a lit and a shaded side at once | Any measurable cost, or the user cannot see it | **next** — free in the lab (+0.02 ms), needs a look on the board |
| 1.2 | **The old wind back** — front with lulls, three-wave body phased on crosswind, per-plant fast term. Lab with a strength slider and a still/gust toggle | Gusts cross the field as patches with visible lulls; no plane-wave carpet; reads as flow from above | > 0.3 ms (it is vertex-only) | |
| 1.3 | **Blade variety** — per-instance hue/height/width/curve/tilt from the clump hash; base→tip colour with a mix factor; AO at the root | Two neighbouring tufts are never obviously the same object | > 0.3 ms | |
| 1.4 | **Mixed sward structure** — trodden patches, mown verge, taller unmown drifts | The field has places rather than one texture | — | |
| 1.5 | **Scanned flora reads pale and scattered** (was regression 2c) — colour dilation under the mask, more than one noise octave for drift, and the translucency finding below | Flora sits *in* the sward, not on top of it; leaf rims do not drift toward the atlas black with distance | — | |

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
| 2.1 | **Hardware scaling** lab at 0.5 / 1 / 1.25 / 1.5 | A setting under 16.6 ms the user cannot tell apart at the play camera | Every setting under 16.6 ms is visibly soft | measured, not judged: 0.5 → 19.7 ms, 1 → 11.6, 1.25 → 10.4, 1.5 → 9.9 |
| 2.2 | **Purpose-written blade `ShaderMaterial`** vs PBR-with-subsurface, with vertex-shader NDC culling (forum 62558) | ≥ 1.5 ms saved, field looks the same or better | < 0.5 ms saved | |
| 2.3 | **Translucency audit** | Off is not darker | Off is visibly flatter | **done — refused.** Lab says on costs 0.4 ms *and* is flatly darker. Turning it off on the board is the next board change |
| 2.4 | **Baked geometry vs thin instances** for one patch (forum 46756's 4× claim) | ≥ 2 ms saved at equal blade count | < 0.5 ms, or it breaks the compute placement | |
| 2.5 | **Trees and scrub** — 4.93 ms, the *largest* piece and never examined | — | — | |
| 2.6 | **Shadows** — 4.03 ms for two cascades at 2048 | — | — | |

---

## Phase 3 — re-examine the refused list

Each in its own lab. **Rule:** if a technique is standard in shipping games for
this kind of scene and the lab says it fails, assume the implementation is
wrong, find the reference, and diff against it before refusing. Refusing an
industry standard needs a citation for why this renderer is the exception.

| | Work | State |
|---|---|---|
| 3.1 | `pipeline.samples = 2` MSAA — the 24 ms figure came from `antialias: true` on the engine, which is a different thing | |
| 3.2 | Alpha-to-coverage, once `sampleCount > 1` | blocked on 3.1 |
| 3.3 | SSAO2 with the sky mask (forum 63942) and `excludedMeshes` on the prepass | |
| 3.4 | Grass receiving shadows via a lifted proxy | refused twice; 3.3 ms and acne |
| 3.5 | God rays with a real sun quad | |

---

## The lab

`/board/lab` lists every screen. One technique each, on the smallest scene that
exercises it, with the criterion written **before** the demo was built.

| screen | phase | result |
|---|---|---|
| `blade` | 1.1 | refused 2026-09-12 on cost — 21.0 ms against 47.1 on the board. The look objection in the first result was a bug in my blade, not the technique |
| `translucency` | 2.3 | refused 2026-09-12 — 10.1 on / 9.7 off, and on is darker |

### 1.1, in full — and the first verdict was right for the wrong reason

Where it stands: it costs 2.2x the frame and it looks better than the cards
close up. The first pass also said it did not look like grass, and that was my
bug, not the technique. **Yours to call.**

| option | triangles, all four species | play camera | vs card |
|---|---|---|---|
| card | 70 | 21.0 ms | — |
| blade | 458 (6.5x) | 47.1 ms | **2.2x the frame** |

Per species, card → blade: grass 20 → 90, fog 22 → 94, clover 8 → 49,
**plantain 20 → 225**. Plantain is a rosette of five broad ribbed leaves and each
one is being turned into five grass blades, which is both botanically wrong and
half the added cost. Blades belong to the grasses; that is untried.

Cost rises 2.2x on 6.5x the triangles, so it is not purely geometry — the card's
alpha-test overdraw is real and the blade does not pay it.

**Version one was broken in four ways at once and distant screenshots hid all of
them.** The user asked to see one blade from eight angles, which showed every
fault in about a minute:

1. **Width came from `cut.aspect`** — 0.65 for a spray cut, 0.04 for a blade cut.
   Same divisor, so one group was ten times the other: slabs and wires in the
   same field. Width is absolute now, from `plant.wide`.
2. **No real taper.** `pow(1 - t, 0.5)` over three stacks is parallel-sided then
   a sudden spike. It is a shoulder-then-point curve over five stacks now.
3. **The tuft splayed into a five-foot starfish** from a three-foot plant — fan,
   tilt and root spread compounding. The blades turn on the golden angle now, so
   a tuft is round rather than a paper fan.
4. **The holes were the alpha test.** The UVs sampled the interior of a cut-out's
   bounding *span*, which is the transparent gap between the scanned blades, so
   the cutout punched holes through solid geometry.

**A generated blade cannot be textured from a cut-out atlas at all.** Making the
material opaque to stop the holes just sampled the atlas's black background
instead, and the tuft came out near-black. The blade takes its colour from the
species table now, with the root-to-tip gradient `blade-wind` already had and the
scans had made unnecessary.

Rebuilt, it reads as real grass from every angle and **it looks better than the
cards close up** — longer, layered, with depth the cut-outs do not have. It still
costs 2.2x the frame, so the refusal stands, on cost alone.

It is on the board behind a **cards / blades** switch so the comparison can be
made on the real field rather than on a lab patch. The blade meadow is not built
until the switch is first used.

**The twist is still the free half.** +0.02 ms in the lab, image change 1.46
against a control of 0.51.

### The card, photographed the same way — and it is the flawed one

The user has said the card is flawed. It had never been isolated and looked at;
only ever seen as a field of a hundred thousand. Same probe, same eight angles,
same scale as the blade:

**A grass card is two crossed flat strips carrying two or three photographed
strands.** From most angles it reads as a letterform — F, X, A, K — and at two of
the eight it is a pair of hairlines. Green coverage of the frame, per angle:

| | per-angle coverage (per mille) | swing | mean |
|---|---|---|---|
| card | 2.7 4.2 6.5 4.2 2.1 4.9 6.6 5.7 | **3.2x** | 4.6 |
| blade | 25.2 25.4 23.1 24.5 24.5 22.5 23.5 20.9 | 1.2x | 23.7 |

Two things fall out of that, and the second one undoes a comparison I published.

**The card loses two thirds of its silhouette depending on where you stand.** The
blade tuft is rotationally stable to within 20%. The field hides this because
there are a hundred and twelve thousand of them at random facings, so the
aggregate is smooth — but no single plant is a plant, and anything that makes the
camera prefer one direction will show it.

**A card draws a fifth of the plant a blade tuft does** — 4.6 against 23.7 at the
same instance count and the same distance. So every cost comparison in this
document so far has been at equal *instances*, not equal *coverage*: the blade
was putting roughly five times more grass on screen for its 2.2x. Matched on
coverage instead of on instance count, the cost question is open and untested.

I also wrote that a card carries "a photo of five-to-ten real blades". It carries
two or three. That was wrong.

### What this cost, as a lesson

Two refusals were published from screenshots taken at 300 half-feet. At that
distance a tuft is four pixels and a broken tuft is also four pixels. **Look at
one of the thing before judging a field of them** — the lab has a route for it
now.

## Standing rules

- **Do not refuse anything.** Measure it, show it, say what the numbers and the
  look are, and put the decision to the user. "Refused" is theirs to say, not
  mine — and the blade is why: it was refused twice on a look that was my own
  bug.
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
