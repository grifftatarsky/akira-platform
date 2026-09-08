# The combat simulator

A design proposal, not yet built. Numbers in here were measured against the
seeded database on 2026-09-08; rules quotes are from our own SRD 5.2 glossary
import, not from memory.

---

## Three nouns

| Noun | What it is | Lifetime |
|---|---|---|
| **Encounter** | The saved setup: a map, its terrain, and everything placed on it with its per-encounter modifications. | Reusable, edited freely |
| **Battle** | One playthrough of an Encounter. Initiative order, current state, and the log. | Created at "start", never edited by hand |
| **BattleEvent** | One thing that happened, with its dice. Append-only. | Immutable |

"Run this encounter three times" is three Battles against one Encounter. That
separation is what keeps a saved encounter reusable after you have played it.

---

## The decisions that matter

### 1. The log is the engine, not a side effect

A Battle **is** its event log. Current state is a fold over that log, materialised
into tables so reads stay cheap.

The obvious alternative — mutate state, write a log line about it — is cheaper to
build and cannot support what this simulator is for:

- **Counterspell forces the pipeline.** A reaction that interrupts a spell
  *before it resolves* means an action cannot be a function that atomically
  mutates state. It has to be declare → open a reaction window → resolve. Once
  that exists, the event pipeline exists; the only question is whether we also
  get the other three benefits for free.
- **Undo is truncate-and-refold.** A DM who wants to see how a round would have
  gone differently is the entire point of a simulator.
- **The log the DM reads is the state**, so the two cannot drift.
- **A seeded RNG plus a full roll record makes a Battle replayable**, which is
  what later buys "run this 200 times, show me the damage spread" almost free.

Cost: real machinery up front, and a fold that has to stay correct. Accepted.

### 2. The engine proposes, the DM disposes

**Measured, against the 1,323 monster features we imported:**

| | Count |
|---|---|
| Features carrying structured effects (engine can resolve) | 604 |
| Prose only | 719 |
| — of those, passive traits | 303 |
| — of those, **actions the engine cannot execute** | **416** |

So of the 988 actionable features in the bestiary, roughly **4 in 10 will never
auto-resolve** from the text we have. A design that treats "cannot execute this"
as an error fails on 40% of the book.

Prose features are therefore a **first-class path**: the engine offers the
feature, prints the book's text, and records the DM's stated outcome as an event.
Same log, same undo, same replay — a human simply occupies the resolution step.

This is also what makes the whole epic tractable. **The engine's job is
bookkeeping and offering legal options, not adjudication.**

### 3. Reaction windows, not just a pause between turns

A visible pause between turns is necessary and not sufficient: counterspell and
opportunity attacks fire mid-action.

The engine advances until it needs a decision, then stops:

```
advance(battle) -> COMPLETE | PENDING(prompt)
```

Windows open at:

| Trigger | Real example |
|---|---|
| `ACTION_DECLARED` | Counterspell, Shield |
| `LEAVING_REACH` | Opportunity Attack |
| `DAMAGE_PENDING` | Absorb Elements, Uncanny Dodge |
| `TURN_ENDED` | the general pause |

`LEAVING_REACH` is not a design flourish; the SRD is specific: *"The attack
occurs right before the creature leaves your reach."* You cannot get that right
by resolving movement and then logging it.

Each window lists eligible reactors: participants holding an unspent Reaction and
a feature with `activation = REACTION` (there are 24 in the bestiary).
`Feature.triggerText` already carries the book's prose for what provokes each.
**The engine never parses trigger text** — it offers the candidates and shows the
words.

### 4. Surprise is an initiative modifier; on-deck is a separate axis

From our own glossary import:

> "If a creature is caught unawares by the start of combat, that creature is
> surprised, which causes it to have Disadvantage on its Initiative roll."

That is the 2024 rule, and it is far smaller than the 2014 "lose your first turn"
that most people reach for: a boolean on the participant, consumed once, at
initiative.

Three independent axes, deliberately not collapsed into one enum:

- **Presence** — `ACTIVE` (in the fight, rolls initiative) or `ON_DECK` (on the
  board or in the wings, not in combat). The DM promotes an on-deck combatant at
  any point; they roll initiative and slot into the order. That one mechanism
  covers reinforcements, the ambush from the balcony, and "the ogre wakes up on
  round 3".
- **Surprised** — consumed at initiative.
- **Hidden** — under 2024 rules a successful Hide confers the Invisible
  condition, so this rides the existing condition model.

### 5. Customisation is copy-on-write; scaling is a descriptor

Two things that look alike and should not share a mechanism:

- **Hand edits** ("this goblin carries a longbow and has 4 more HP") clone the
  StatBlock into an encounter-private row, keeping `overridesId` pointing at the
  original so provenance survives. This is the copy-on-write machinery
  `AbstractCatalogService` already implements; its scope widens from user to
  encounter.
- **Scaling** ("make this a CR 3 goblin") stores the *descriptor* — HP multiplier,
  AC delta, damage multiplier — and applies it at battle start. One row instead
  of a clone, and it stays legible and re-tunable afterwards.

Clone lazily: an unmodified combatant just points at the shared catalog row.

**The trade-off to accept deliberately:** until it is cloned, editing the
compendium goblin changes every saved encounter that uses it. Usually that is
what you want (a fix propagates), but it is a choice, not an accident.

---

## The board

### The SRD is gridless, so the grid is ours

Worth stating plainly, because it is easy to assume otherwise: **SRD 5.2 contains
no grid rules.** It speaks in feet and *spaces*. Searching the whole glossary
import for "grid" or "square" returns one entry, and it is Thin Ice. Grid
movement is an optional variant in the PHB, which is not SRD content.

So a square grid is our imposition — defensible for a tactical simulator that
wants real geometry, but we own the distance rule rather than citing it. Three
options, and I would take the first:

| Rule | Diagonal cost | Note |
|---|---|---|
| **Chebyshev** | 5 ft | The PHB's own simplification. Cheap, and what most tables actually play. |
| Alternating | 5/10/5/10 | The 3.5e rule. More accurate, annoying to explain in a UI. |
| Euclidean | 7.07 ft | Truest, but fractional feet fight every other rule in the book. |

### Storage is sparse

`BattleMap`: `width`, `height`, `cellFeet` (default 5), and a default terrain.

`MapCell` rows exist **only where a cell differs from the default**. A 40×40 board
is 1,600 cells and nearly all of them are plain floor.

Per cell:

| Field | Why it is there |
|---|---|
| `elevationFeet` | Falling is real damage: *"1d6 Bludgeoning for every 10 feet, max 20d6"*, and Prone on landing. Slope derives from neighbours; a ramp *within* one square can wait. |
| `movementCost` | Difficult Terrain, per the book: *"every foot of movement in that space costs 1 extra foot… isn't cumulative"* |
| `cover` | NONE / HALF / THREE_QUARTERS / TOTAL → +2 AC, +5 AC, cannot be targeted |
| `opaque` | blocks line of sight |
| `light` | BRIGHT / DIM / DARKNESS. We already import Bright Light, Dim Light, Darkness, Lightly Obscured, Heavily Obscured and Darkvision — obscurement *is* combat geometry, and the cell is where it lives. |
| `terrain` | FLOOR / WATER / LAVA / PIT / WALL … |

### Movement cost is not purely static

The book again: a space is Difficult Terrain if it contains *"a creature that
isn't Tiny or your ally."* So the cost of entering a cell depends on **who is
standing in it right now**. Cost is therefore `static cell cost + dynamic
occupancy`, computed at move time, never cached on the cell.

That single sentence is the reason pathfinding has to run against live battle
state rather than against the saved map.

### Caps

40 combatants, 60×60 cells (a 300-foot square). Configurable. Past roughly 20
an initiative order stops being usable at a real table, so this is a usability
guardrail more than a technical one.

---

## Phases

Each ships something usable on its own.

| # | What | Why it stands alone |
|---|---|---|
| 1 | `Encounter`, `BattleMap`, `MapCell`, `Combatant`, placement, CRUD | A DM can build and save a tactical map with monsters on it |
| 2 | Encounter-scoped copy-on-write; scaling descriptors | "A beefed-up goblin" without polluting the compendium |
| 3 | `Battle`, `Participant`, `BattleEvent`, initiative, turn order, state machine, the pause — **no action resolution** | An initiative tracker with a map. Useful at a table immediately |
| 4 | Action resolution: Feature → Step → Effect, attacks, saves, damage, conditions, HP, movement | The simulator proper |
| 5 | Reaction windows, on-deck promotion, surprise, concentration and duration ticking | The part the epic is actually for |
| 6 | WebGL board, reusing what JPSS taught us about deck.gl | The table |

Backend through 1–5 with a plain functional UI to drive it; 6 is the real board.

---

## Four gaps found while grounding this

These are defects in what is already imported, not new work invented for the
simulator. All four bite in phase 4 or 5.

1. **`legendary_cost` is NULL on all 82 legendary actions.** The importer set
   `activation = LEGENDARY` but never the cost, so a legendary action budget
   cannot be spent. Parser fix, needed before phase 4.
2. **303 passive traits have no mechanical representation.** Pack Tactics, Magic
   Resistance, Amphibious — they modify *other* creatures' rolls rather than
   being invoked, and nothing in the model expresses "advantage when an ally is
   within 5 feet." This needs a modifier/rider concept that does not exist yet,
   and it is the largest genuinely-new modelling work in the epic.
3. **Only two `EffectKind`s are populated** — DAMAGE (793) and APPLY_CONDITION
   (220). HEALING, MOVEMENT, TEMPORARY_HIT_POINTS, SUMMON and AREA_TERRAIN are
   declared but unused, so those code paths will be written without real data to
   test them against.
4. **Nothing models a creature's threatened area.** Opportunity attacks need
   "this creature threatens these cells", derived from its best melee
   `FeatureStep.reachFeet` — the SRD default being *"a reach of 5 feet unless a
   rule says otherwise."*
