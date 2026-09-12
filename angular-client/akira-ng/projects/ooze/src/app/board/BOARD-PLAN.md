# The board: the list

The working checklist. `BOARD-HANDOFF.md` is the state and the research,
`PLAN.md` the rules, the refused table and the traps. This is what gets crossed
off.

Updated 2026-09-12. Published as an Artifact for the Claude GUI —
https://claude.ai/code/artifact/a3019fb5-028c-4cd6-b34c-a22dad6b13f9 — and when
an item moves here, that page is republished. Ticks on the page live in its own
store and survive a republish, so crossing something off there is not undone by
an update here.

**Where we are:** 45 fps at maximum plants (22.2 ms). Target is 60 (16.6 ms).
The order is **look first, then optimize** — Phase 1 before Phase 2.

---

## Phase 0 — instruments and regressions

| | Work | State |
|---|---|---|
| 0.1 | Per-pass GPU breakdown | **done** — and it found the 8.1 ms baseline was an instrument fault, not a cost |
| 0.2 | Bald ring: one shared wear fade | **done** — coverage map has no thin cell off the track |
| 0.3 | Absolute density; `MAX_PLANTS` a cap | **done** — `swardLattice()` pure and unit-tested; board opens at maximum |
| 0.4 | Lab harness: `/board/lab` + one worked screen | **done** — index, shell, A/B switch, wall clock, pixel diff with a control |

Phase 0 is closed.

---

## Phase 1 — the grass itself

The user's main complaint, and the reason the order is look-first. Every item
gets a lab screen before it touches the meadow.

| | Work | Working = | Not helping = | State |
|---|---|---|---|---|
| 1.1 | **Blade mesh** — quadratic-Bézier blade, `2·stacks+1` verts, tapered to a tip, **±0.3π rotated normals**. Lab it against the current card, side by side | No visible repetition at the play camera; blades read as rounded, not as flat strips | > 1.0 ms over cards at equal density | next |
| 1.2 | **The old wind back** — front with lulls, three-wave body phased on crosswind, per-plant fast term. Lab with a strength slider and a still/gust toggle | Gusts cross the field as patches with visible lulls; no plane-wave carpet; reads as flow from above | > 0.3 ms (it is vertex-only) | |
| 1.3 | **Blade variety** — per-instance hue/height/width/curve/tilt from the clump hash; base→tip colour with a mix factor; AO at the root | Two neighbouring tufts are never obviously the same object | > 0.3 ms | |
| 1.4 | **Mixed sward structure** — trodden patches, mown verge, taller unmown drifts | The field has places rather than one texture | — | |
| 1.5 | **Scanned flora reads pale and scattered** (was regression 2c) — colour dilation under the mask, more than one noise octave for drift, and the translucency finding below | Flora sits *in* the sward, not on top of it; leaf rims do not drift toward the atlas black with distance | — | |

---

## Phase 2 — the frame

Sequenced after Phase 1. 0.1 already says which of these is worth doing.

| | Work | Working = | Not helping = | State |
|---|---|---|---|---|
| 2.1 | **Hardware scaling** lab at 0.5 / 1 / 1.25 / 1.5 | A setting under 16.6 ms the user cannot tell apart at the play camera | Every setting under 16.6 ms is visibly soft | measured, not judged: 0.5 → 19.7 ms, 1 → 11.6, 1.25 → 10.4, 1.5 → 9.9 |
| 2.2 | **Purpose-written blade `ShaderMaterial`** vs PBR-with-subsurface, with vertex-shader NDC culling (forum 62558) | ≥ 1.5 ms saved, field looks the same or better | < 0.5 ms saved | |
| 2.3 | **Translucency audit** | Off is not darker | Off is visibly flatter | **done — refused.** Lab says on costs 0.4 ms *and* is flatly darker. Turning it off on the board is the next board change |
| 2.4 | **Baked geometry vs thin instances** for one patch (forum 46756's 4× claim) | ≥ 2 ms saved at equal blade count | < 0.5 ms, or it breaks the compute placement | |
| 2.5 | **Trees and scrub** — 4.8 ms, the second largest piece and never examined | — | — | |
| 2.6 | **Shadows** — 3.8 ms for two cascades at 2048 | — | — | |

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
| `translucency` | 2.3 | refused 2026-09-12 — 10.2 on / 9.7 off, and on is darker |

A refused screen stays, with its numbers and its date, so the refusal can be
re-run when Babylon or the board changes.

---

## Standing rules

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
