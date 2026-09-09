# The combat simulator

A design, not yet built. Numbers were measured against the seeded database;
rules quotes come from our own SRD 5.2 import, not from memory.

---

## Three nouns

| Noun | What it is | Lifetime |
|---|---|---|
| **Encounter** | The saved setup: a map, its terrain, and everything placed on it. | Reusable, edited freely |
| **Battle** | One playthrough of an Encounter. Initiative order, live state, and the log. | Created at "start", never hand-edited |
| **BattleEvent** | One thing that happened, with its dice. Append-only. | Immutable |

"Run this encounter three times" is three Battles against one Encounter.

---

## Geometry: continuous positions, Chebyshev distance

A grid is the wrong thing to store and the right thing to measure with. So we do
both, and they are different layers.

**Positions are continuous.** A token's location is `x`, `y`, `elevation` in
feet, as decimals. Nothing snaps. Put the rogue half behind the pillar if that is
where the rogue is.

**Distance is Chebyshev** — `max(|dx|, |dy|, |dz|)`. This is usually described as
a grid metric, but it is perfectly well defined on continuous space, and it is
exactly the rule D&D plays by: a diagonal costs the same as a straight line.
Three consequences fall out for free:

- 30 ft across and 30 ft up is **30 ft**, not 42 — which is how the game treats
  flying, without a special case.
- On tokens that happen to sit on 5-ft centres it reproduces square counting
  exactly, so a DM who thinks in squares is never surprised.
- No fractional feet anywhere, so it never fights the rest of the book.

**Terrain is a raster.** Terrain is *painted*, so it stores as a grid of cells —
but placement does not have to share that resolution. Looking up the ground under
a token is sampling the raster at a continuous point. `cellFeet` (default 5) is
the terrain resolution and nothing more.

**Creatures occupy space, not points.** A Large creature is a 10-ft box, not a
dot. Reach, cover, and "is it adjacent" measure **edge to edge**. This is what
makes granular placement actually mean something rather than being cosmetic.

Per cell, all sparse — a row exists only where it differs from the map default,
because a 40×40 board is 1,600 cells and nearly all of them are plain floor:

| Field | Why |
|---|---|
| `elevationFeet` | Falling is real damage: *"1d6 Bludgeoning for every 10 feet, max 20d6"*, Prone on landing. Slope derives from neighbours. |
| `movementCost` | *"every foot of movement in that space costs 1 extra foot… isn't cumulative"* |
| `cover` | NONE / HALF / THREE_QUARTERS / TOTAL → +2 AC, +5 AC, cannot be targeted |
| `opaque` | blocks line of sight |
| `light` | BRIGHT / DIM / DARKNESS — we import Lightly and Heavily Obscured and Darkvision, so obscurement is combat geometry and lives here |
| `terrain` | FLOOR / WATER / LAVA / PIT / WALL … |

### Everything is computed live

No caching, anywhere, until something is measured slow. Pathfinding, line of
sight, cover and threatened area are computed per query against live battle
state.

That is not only a scheduling preference — the book forces part of it. A space is
Difficult Terrain if it contains *"a creature that isn't Tiny or your ally"*, so
the cost of entering a cell depends on **who is standing there right now** and on
**who is asking**. A cached cost would be wrong for the next creature to look.

---

## The instance model: the SRD row is never copied to play

Three layers, and the important part is that the middle one exists.

```
StatBlock (shared, SRD)        ← never mutated, never cloned to play
   ↑ references
Combatant (design-time)        ← the Encounter's shell: base + sheet + placement
   ↓ instantiates per Battle
Participant (run-time)         ← current HP, spent slots, conditions, position
```

**`Combatant`** is what you place on the board. It points at a base and carries
its own sheet: display name, HP override, inventory, prepared spells and slots,
and any stat deltas. An unmodified goblin points straight at the SRD row — no
clone, no copy, no drift.

**`Participant`** is created fresh when a Battle starts and holds everything that
changes during the fight. Damage taken, slots spent, conditions, reaction
available, position. It never touches the Combatant, so an Encounter can be run
ten times without accumulating scars.

**So cloning is only ever for stat surgery** — "this goblin has 40 HP and a
different attack." That is the existing `AbstractCatalogService` copy-on-write:
an override row keeping `overridesId` back to the SRD original, not a copy of the
catalog. Almost nobody will need it, because the sheet covers what people
actually change.

### An NPC wraps a monster the way a character wraps a species

`GameCharacter` already carries `species`, `vocation`, `subclass`, `background`,
`level` and a `statBlock`. Let a **monster stat block stand in the base slot
where a species normally goes**, and "Grish, goblin boss, three levels of
Fighter, carrying a magic sword" is a `GameCharacter` — with an inventory, spell
slots and hit points of its own — rather than a new kind of thing.

The payoff is that PCs, NPCs and monsters are one type to the engine. The
initiative tracker, the action menu and the log do not care which they are
looking at.

### Scaling is a descriptor, not baked numbers

"Make this a CR 3 goblin" stores the transform — HP multiplier, AC delta, damage
multiplier — and applies it when the Battle starts. One small row instead of a
clone, and still legible and re-tunable afterwards, which a set of baked numbers
would not be.

---

## The log is the engine

A Battle **is** its event log; live state is a fold over it, materialised into
tables so reads stay cheap.

The cheaper alternative — mutate state, write a log line about it — cannot
support what this is for. **Counterspell forces the pipeline**: a reaction that
interrupts a spell *before it resolves* means an action cannot be a function that
atomically mutates state. It has to be declare → open a window → resolve. Once
that exists, the pipeline exists, and undo-by-truncation, a log that cannot drift
from state, and seeded replay all come with it.

### What carries it — the comparison

| Option | Gives | Costs | Verdict |
|---|---|---|---|
| **Plain append-only table, Spring Data JDBC** | Ordered, queryable, replayable. `jsonb` payload. No identity map, no dirty checking, no lazy loading on a table that is insert-only plus range scan. | We write the fold ourselves | **This is the event store** |
| Same table via **JPA** | Already in the module | Every piece of ORM machinery is overhead here, and none of it is wanted | No — for the log specifically |
| **Spring Modulith 2.1.1** *(resolves clean against Boot 4.1.1 — verified)* | Module boundary verification, `@ApplicationModuleListener`, Event Publication Registry | The registry is a **delivery outbox keyed by listener**, not an ordered aggregate log — using it as the event store means fighting it on ordering, querying and replay | **Yes — for boundaries. Not as the store.** |
| **Spring Statemachine** | A formal FSM with guards and transitions | A persisted FSM is a *second* source of truth beside the log, free to disagree with it. The fold already **is** the state machine. | No |
| **Axom / Axon-style ES framework** | Full event sourcing and CQRS | Heavyweight, its own conventions, not Spring-supported | No |

Modulith earns its place for a different reason than events: the tracker has to
be **shippable on its own** (below), and that is a module boundary. Modulith
turns "the tracker must not reach into the map" from a good intention into a
failing test.

The rest of the modern-Boot surface that actually buys something here:
`spring.threads.virtual.enabled` (Boot 4 on Java 26), `jsonb` + GIN on the event
payload, `@Version` on Battle plus a row lock so two concurrent `advance()` calls
serialise instead of interleaving, and SSE to push state to watchers.

### Dice are recorded, not just rolled

Every roll is an event carrying its inputs and its result, and a Battle carries a
seed. `RollSource` is RANDOM, MANUAL (the DM rolled a real die and typed it) or
AVERAGE (use the book's printed average — the fast path). This is what makes a
Battle reproducible, and it is what later buys "run this 200 times, show me the
damage spread" almost free.

---

## The engine proposes, the DM disposes

The engine never decides what a creature does. Each turn it hands the DM a menu
of legal options **with the numbers already worked out**; the DM picks; the
engine does the arithmetic and the bookkeeping.

**The engine owns what is countable. The DM owns what is judgment.**

| Engine | DM |
|---|---|
| Whose turn, what round, what is left of the movement budget | Which creature does what |
| What this creature can legally do right now | Which of those to pick |
| Who is in range, who has cover, what the DC is | Whether an unusual thing should work at all |
| Roll, compare, subtract, apply, expire | Rule on anything the book left as prose |

### Walkthrough 1 — a turn the engine resolves end to end

DM clicks **Advance**. The engine stops on the Owlbear and shows:

> **Round 2 — Owlbear (47/59 HP)** · 40 ft movement left
> **Actions**
> - **Rend** — melee, reach 5 ft · *in range:* Thalia (AC 16 — 15 ft away, needs 10 ft of movement), Bram (AC 18, adjacent, **half cover → AC 20**)
> - **Multiattack** — 2 × Rend

The DM drags the Owlbear 10 ft and clicks **Rend → Thalia**:

1. `d20+7` → **19 vs AC 16, hit** — logged with the die, the bonus, and Thalia's AC *at that moment*
2. `2d8+5` → **14 Slashing**
3. Thalia 31 → **17 HP**

The DM was asked one thing: who. Every number came from the imported stat block
(Owlbear Rend really is `ATTACK_ROLL +7`, `2d8+5` Slashing).

### Walkthrough 2 — a turn the engine cannot resolve: the prose part

Same battle, the Oni's turn. Its **Shape-Shift** reads:

> "The oni shape-shifts into a Small or Medium Humanoid or a Large Giant, or it
> returns to its true form. Other than its size, its game statistics are the same
> in each form."

There is nothing to roll. No attack, no save, no damage, no condition — the book
wrote a **rule**, not a **procedure**. Our parser produced zero effects for it,
correctly, because there are none to find.

So the engine offers it differently:

> **Oni (Large) — Actions**
> - Claw *(engine resolves)*
> - **Shape-Shift** *(you resolve)* — "The oni shape-shifts into a Small or Medium Humanoid or a Large Giant…"
>   → [ set size ▾ ] [ note ] [ done ]

The DM picks Medium. The engine records the change, shrinks the token's footprint
on the map — which changes reach and cover for everyone around it — and moves on.

**That is the prose part.** The feature is still in the menu, still spends the
action, still lands in the log, still undoes cleanly. The only difference is that
the outcome came from the DM instead of from dice.

**Why it is load-bearing:** the count was 416 when this was written and is now
**58**, after linking everything that pointed at a spell, a sibling feature or a
standard action, and giving every passive a rider, a capability or a trigger. The
path still matters — Shape-Shift genuinely has nothing to roll — but it is the
exception it should always have been rather than four actions in ten.

### The rule this all serves

**The simulator has to be able to do everything the book can, as a representable
quantity, triggerable where the book triggers it.** That is the standard the
import is held to, and it is asserted rather than asserted-about: a test fails if
any seeded passive is left with no rider, capability, trigger, aura, component,
shape or effect.

Where a thing genuinely resists mechanism — a 30 percent chance of knowing Wish,
a GM's choice of dragon — it is still *represented*, as `Capability.OTHER`
carrying the book's words, and the count of those is asserted so it cannot
quietly grow. Sixteen, today.

**The three voices, and the fourth thing.** Damage and conditions were all the
model had. It now has:

| Shape | Says | Count |
|---|---|---|
| `Effect` | what happens — damage, conditions, healing, movement, temp HP, summons, terrain | 1,255 |
| `Rider` | what is modified — Advantage, a bonus, halved Speed, a denied Reaction, an auto-succeeded save | 160 |
| `Capability` | what is permitted — breathes water, climbs ceilings, provokes nothing on exit | 161 |
| `TriggerEvent` | *when* it fires — on death, at 0 HP, on Lightning damage, at turn end while Bloodied | 95 |

`INFORMATION` effects and `Capability.OTHER` are the surface for anything that
changes no state but that a DM must still see. Both land on the turn's record,
which is what the "things to consider" panel reads — it is not a separate model,
it is a view over effects that carry prose instead of numbers.

### Walkthrough 3 — the interrupt

Thalia casts Hold Person on the Bandit Captain. The engine does **not** resolve
it. It appends `ACTION_DECLARED` and stops:

> **Reaction window — Hold Person, Thalia → Bandit Captain**
> - **Bandit Captain — Parry** — *"Trigger: The bandit is hit by a melee attack roll while holding a weapon."*
> - Cultist — Counterspell *(reaction available)*
> [ let it resolve ] [ take a reaction ▾ ]

Two things to notice. The engine **listed Parry even though its trigger plainly
does not match** — it does not parse trigger text, it shows the book's words and
lets the DM judge, and it will not hide an option from you on the strength of a
regex.

And this window opened **mid-action**, not between turns. Counterspell has to
land after "I cast Hold Person" and before the save is rolled. That is precisely
why a pause between turns is not sufficient on its own, and the main reason the
log-first design earns its cost.

### Where windows open

| Trigger | Example |
|---|---|
| `ACTION_DECLARED` | Counterspell, Shield |
| `LEAVING_REACH` | Opportunity Attack — the SRD is specific: *"The attack occurs right before the creature leaves your reach"* |
| `DAMAGE_PENDING` | Absorb Elements, Uncanny Dodge |
| `TURN_ENDED` | the general pause |

### A reaction must be able to rewrite the declared action, not only cancel it

The goblin's Redirect Attack:

> "Trigger: A creature the goblin can see makes an attack roll against it.
> Response: The goblin chooses a Small or Medium ally within 5 feet of itself.
> The goblin and that ally swap places, and the ally becomes the target of the
> attack instead."

Two creatures change square **and** the attack's target changes, all while the
attack is mid-flight. So a reaction window returns an *amended* declaration, not
just a yes/no on whether the original proceeds. The pipeline is
`declare → window → (amend | cancel | proceed) → resolve`, and because the
declaration is an event like everything else, the amendment is another event
pointing at it with `causedBySeq`.

Counterspell is the cancel case, Shield the amend-the-AC case, Redirect Attack
the amend-the-target-and-positions case. Building only cancel would make the
third impossible to add later without reshaping the pipeline.

---

## Surprise, and who is in the fight

From our glossary import:

> "If a creature is caught unawares by the start of combat, that creature is
> surprised, which causes it to have **Disadvantage on its Initiative roll**."

That is the 2024 rule, and it is far smaller than the 2014 "lose your first turn"
most people reach for: a boolean consumed once, at initiative.

Three independent axes, deliberately not one enum:

- **Presence** — `ACTIVE` (in the fight, rolls initiative) or `ON_DECK` (on the
  board or in the wings, not yet in combat). The DM promotes an on-deck combatant
  at any moment; they roll initiative and slot into the order. One mechanism
  covers reinforcements, the ambush from the balcony, and the ogre waking up in
  round 3.
- **Surprised** — consumed at initiative.
- **Hidden** — a successful Hide confers the Invisible condition under 2024
  rules, so this rides the condition model we already have.

---

## Phases

| # | What | Ships as |
|---|---|---|
| 1 | ✅ **Done.** `Encounter`, map, terrain, `Combatant`, placement, painting, geometry, falling, REST | A DM can build and save a tactical map |
| 2 | ✅ **Done.** Scaling descriptors, encounter-scoped copy-on-write, NPC-wraps-monster | "A beefed-up goblin" without touching the compendium |
| 3 | ✅ **Done.** `Battle`, `Participant`, `BattleEvent`, initiative, turn order, the pause, rewind. No resolution, **no map** | **A standalone initiative tracker.** Useful at a table on its own |
| 4 | ✅ **Done.** Feature → Step → Effect: attacks, saves, damage with resistances, conditions, riders, adjudication | The simulator proper |
| 5 | ✅ **Done.** Reaction windows, amending a declared action, movement, opportunity attacks, on-deck promotion, surprise, duration ticking | The part the epic is for |
| 6 | WebGL board, reusing what JPSS taught us | The table |

### What phase 1 actually shipped

- **Geometry in half-feet.** Chebyshev on continuous positions; footprints measured edge to edge. The unit is the half-foot because every SRD distance is a multiple of 5 feet and a Tiny creature's square is 2½ — so every number in the engine is an exact integer and no placement ever rounds.
- **A sparse terrain raster.** Cells exist only where a square differs from the map's defaults. Terrain, light, cover, opacity, elevation and a static movement cost.
- **`Battlefield`,** answering live: line of sight by a supercover walk, cover by tracing to a target's corners, movement cost including the half that can never be cached, and falling off a ledge.
- **Placement that refuses to stack tokens,** with the exception read off the creature — a swarm carries `OCCUPY_CREATURE_SPACE` and may share a square.
- **Painting in strokes** — rectangle, outline, line, erase — because outlining a cave one square at a time is a few hundred requests.
- **`/encounter`,** gated on `MANAGE_CONTENT` including the reads, 404 for a stranger, 409 for an occupied space.

**Phase 3 is a module, not a step.** The tracker owns turn order and the log and
knows nothing about maps or terrain; the simulator supplies combatants and a map
to a tracker that would work just as well without either.

That boundary is asserted, not intended: a test reads the imports of every file
in the tracker and fails if one reaches for the board. `encounterId` and
`combatantId` are bare nullable UUIDs rather than mappings, so an encounter is
something a battle *may* have come from, never something it needs. The seam that
lifts one into the other lives on the **simulator** side, where the code already
knows about both — putting it in `BattleService` would have inverted the
dependency and quietly made the tracker need a board.

### What phase 5 shipped

An action is now **two calls**: `declare` opens a window and stops, `resolve`
closes it. The stop is the whole point — there has to be a state in which the
action exists and has not happened, and it has to be one a client can render and
leave rather than a moment inside a method call. `BattlePhase.AWAITING_REACTION`
and a persisted `PendingAction` are that state.

**Three verbs, not one.** Cancelling is the easy case and the misleading one:

| Reaction | What it does | Amendment |
|---|---|---|
| Counterspell | the action does not happen | `CANCEL` |
| Shield, Parry, Protection | it happens, against a different number | `MODIFY_DEFENCE` |
| Redirect Attack | it happens, to somebody else | `RETARGET` |

The defence rides on the pending action rather than on the participant, because
that is exactly its lifetime — "against that attack". Writing it onto the
creature leaves the next attacker facing it too, and there is a test that
attacks twice to prove it does not.

**The engine offers candidates; it does not judge triggers.** Everyone in the
fight with an unspent Reaction is eligible, and the DM rules on whether a Parry
that says "hit by a melee attack" applies to a spell. It will not hide an option
on the strength of a regex.

**Conditions expire.** 42 of the imported condition effects state a duration and
nothing ever took one off, so a Poisoned creature stayed poisoned for the rest of
the fight — a rules bug that reads as a damage bug three rounds later.
Round-scale durations now drop at the end of the affected creature's own turn;
minute- and hour-scale ones outlast any fight the tracker runs and are left
alone rather than pretended about.

**Movement is an engine action**, which is what opportunity attacks were waiting
on. A move is a route of waypoints, not a destination: what a square costs, whose
reach it leaves and how far it is down all depend on the path, and two routes to
the same spot can cost very different amounts.

The legs arrive already costed, because costing them needs a board. The tracker
walks them one at a time, spending the Speed budget, and stops at the square that
provokes — **before** taking it, because "the attack occurs right before the
creature leaves your reach". A route through a threatened square is two calls
with a window between them.

**Position moved onto the participant**, for exactly the reason hit points live
there: the Combatant is where a creature was *placed* and must not be scarred by
playing. That is also what makes a rewind put a creature back where it was; while
position lived only on the board, undo restored the hit points and left the
creature standing wherever the undone move had taken it.

Three integers are not a map. The tracker still has no terrain and no geometry —
it carries the answer, not the reasoning.

**One boundary was relaxed, deliberately.** `util.Falling` came off the tracker's
forbidden list: falling damage is a rules table, feet in and dice out, and the
tracker legitimately applies it when a creature drops off a ledge. What made it
look like the board was one method asking whether the ground was water; that
moved to `Battlefield`, and a test now asserts `Falling` imports no terrain at
all, so the exemption cannot quietly become a hole.

### What phase 4 shipped

`ActionResolver` is **pure**: it takes an actor, a feature, targets and what the
board says about them, and returns a list of outcomes. It applies nothing and
writes no log, so every clause of the SRD in it is provable without starting
Postgres — and the same code can be replayed during a rewind without
re-appending anything.

It never looks anything up. Range and cover arrive as a `TargetContext`; the
creature's Armor Class and resistances live on the participant, copied in at
launch. **The participant *is* the creature for the duration of the fight**, so
scaling and any private stat block were already resolved and resolution reads one
row rather than working out which of three sources the real number came from.

Rules that earned their own test: a natural 20 hits whatever the AC is and a
natural 1 misses whatever the bonus is (neither is a comparison); a critical
doubles the dice and not the modifier; cover raises the number to beat rather
than lowering the roll, so the die stays honest in the log; Total Cover is a
refusal rather than a penalty; resistance halves and the log keeps *both* numbers
so a DM can see why 7 became 3; and a chained step only fires when the step
gating it did what its trigger says.

**Declaration and resolution are separate events**, and every consequence carries
`causedBySequence` back to the declaration. That gap is where a reaction lands in
phase 5, and an action that both declared and settled itself in one event would
leave Counterspell nowhere to go.

**Phases are sequential.** 3 was built before 2 to get that boundary test written
before anything could couple to the tracker. That was worth doing once; it is not
a licence to keep reordering, and 2 followed immediately after.

### What phase 2 shipped

Two mechanisms, because they are two different things.

**Scaling is a descriptor.** "Half again as tough" is stored as
`hitPointPercent = 150` and applied when a battle starts, never written back —
so a DM can dial a fight up, run it, dial it down and run it again. A cloned
block with 11 written over 7 could not do that, because nothing afterwards can
tell whether the 11 was a scale or a hand edit. Percentages and deltas, all
integers: a multiplier of 1.5 invites a float into a system that has worked to
avoid them, and 150 says the same thing exactly.

**A private stat block is surgery.** A deep clone, made only when a DM actually
edits the creature, owned by the token with `orphanRemoval` so reverting cannot
leave a row nothing points at. Deep because a shallow copy is worse than none:
sharing features with the book means editing the goblin in an encounter edits
the goblin in the compendium. The whole tree comes — features, steps, effects,
riders, capabilities, shapes — and a Multiattack in the copy is remapped to
invoke *the copy's* attacks, because copying the reference verbatim leaves the
override calling the book's Tentacle and editing it changes nothing.

**An NPC wraps a monster the way a character wraps a species.** `NpcFactory`
gives a `GameCharacter` its own deep copy of a creature's stat block plus
`baseStatBlockId` for provenance, so "Grish, goblin boss, three levels of
Fighter" has an inventory and levels of its own and is one type to the engine.

---

## Import gaps

Four found while grounding this, all now fixed — see the commit "Fix four
bestiary import gaps the simulator would have hit". A fifth I reported was not a
defect at all: the 2024 stat blocks dropped "Costs 2 Actions", so a NULL
`legendary_cost` is the book, not a parser bug.

What is still open, and matters before phase 4:

1. **303 passive traits have no mechanical representation.** Pack Tactics, Magic
   Resistance, Amphibious modify *other* rolls rather than being invoked, and
   nothing expresses "advantage when an ally is within 5 feet". This needs a
   modifier/rider concept that does not exist, and it is the largest genuinely
   new modelling work in the epic. It is also why 182 of the 220 condition
   effects have no duration: many of those riders are Advantage and Disadvantage,
   which are not conditions.
2. **Duration has no anchor.** "Until the *end* of its next turn" and "until the
   *start* of its next turn" both store as one round. Wants a `durationAnchor`
   before the engine ticks on it.
3. **Forced movement has no direction.** Push, pull and slide store the verb in
   `notes`; `movementType` names a *speed*, so it stays null rather than claiming
   the target spent its own movement. Wants a small enum.
4. **Threatened area is not modelled.** Opportunity attacks need "this creature
   threatens these cells", derived from its best melee reach — *"a creature has a
   reach of 5 feet unless a rule says otherwise."*

---

## Phase 6: choosing a renderer

Measured on 2026-09-09, against Angular 22, TypeScript 6 and Native Federation
22. Sizes are **minified and gzipped from a realistic import surface** — a
renderer, a camera, sprites, textures, a couple of primitives and hit-testing —
bundled with esbuild. Not `npm` unpacked size, which counts source maps and three
build formats and is roughly ten times the truth.

### The question that decides it

**Is the board a top-down 2.5D scene, or a 3D one you move a camera through?**

Everything else follows from that, and the answer is not obvious from "paperdolls
and environments": a paperdoll is layered 2D art, and an environment could be
either a beautifully lit top-down map or a room you look around inside.

### The comparison

| | Size (gz) | Packages | Federation risk | What it is for | WebGPU |
|---|---|---|---|---|---|
| **PixiJS 8** | **167 KB** | 1 + leaves | **Low** — v8 collapsed the `@pixi/*` graph into one package | 2D sprite compositing, masks, filters, batching | Yes, v8 |
| **three 0.186** | **131 KB** | **1, zero deps** | **Lowest** | General 3D; 2D is planes and sprites | Yes, `three/webgpu` |
| **Babylon 9** | **328 KB** deep imports · 1 508 KB from the barrel | 1 core + ecosystem | **High** — `loaders`/`materials`/`gui` all depend on `core`: the deck.gl diamond shape | Full 3D engine, editor-adjacent | Yes |
| **deck.gl 9.4** | **254 KB** | 4+ | **Known-bad, already solved once** | Data-driven marks; an `OrthographicView` board is plausible | Via luma |
| **Konva 10** | **57 KB** | 1, zero deps | **Lowest** | 2D canvas scene graph — no GL, so no shader lighting | No |

### Federation is the axis this repo has actually been burned on

Twice, and both are written into `CLAUDE.md` and `jpss-ui/federation.config.mjs`.
Native Federation builds each shared package as a **self-contained chunk** and
does not externalise one shared package from inside another — so any library
whose own packages depend on each other gets duplicated, and singletons inside it
break. deck.gl's `ShaderAssembler` ended up registered on one copy and compiled
against another: every fragment shader failed at runtime, from a green build.

That makes package *count* a first-class selection criterion here, not a detail:

- **three** is one package with zero runtime dependencies. Nothing to duplicate.
- **Pixi v8** is one package whose remaining dependencies are all leaves
  (`earcut`, `eventemitter3`, `tiny-lru`…). v7's `@pixi/*` layout *was* the
  diamond shape; v8 removed it. Worth knowing: `earcut` is CJS, and it is the
  same package the JPSS build already warns about.
- **Babylon** has the diamond. It is survivable — `skip` the whole graph, as
  JPSS does — but it is the pattern that cost this repo an afternoon.
- **deck.gl** is the known case. Reusing it in `ooze` means repeating the `skip`
  block; the lesson is already paid for.

### Fit

**The engine already models what a VTT renderer draws.** Light level per cell
(BRIGHT / DIM / DARKNESS), cover, opacity, elevation, footprints in half-feet,
threatened squares, movement paths. That is a dynamic-lighting and fog-of-war
feature set, and it is the feature set Foundry VTT implements **on PixiJS** — it
moved to v8 and is beginning to use WebGPU. The incumbent in this exact problem
space chose this tool, which is worth more than a benchmark.

**Paperdolls are the tell.** Compositing a body, armour and a weapon into one
token is 2D sprite layering — Pixi's `RenderTexture` is precisely that. In three
you would draw it to a 2D canvas and upload the result as a texture: it works,
and it is doing 2D work inside a 3D engine.

**But if the environment is genuinely three-dimensional** — a camera that orbits,
walls with height you see past, minis on a table you can tilt — then three is the
answer and the paperdoll compositing becomes a small canvas utility beside it.

### Decided: three.js

3D is the ambition, so the board is built with **three** — and the shape of the
build is what makes that ambition cheap rather than a promise.

**The scene is three-dimensional from the first frame; only the camera is
locked.** A floor is a box of zero height, a wall is a box eight feet tall, and a
token sits at its ground elevation plus whatever it is flying. Under an
orthographic camera looking straight down that reads as a flat tactical board.
Swap in a perspective camera — one method, no data change — and the walls are
already walls and the balcony is already above the floor.

Lights are real from the start too, and materials are lit rather than unlit. It
costs nothing under an overhead view and it is the half of 3D-readiness that is
awkward to retrofit.

**World units are half-feet**, matching the engine, so no conversion happens in
the renderer and no rounding decision lives there.

**Z is up**, not three's Y-up default, because the engine's elevation is Z.
Re-basing the world would put a conversion between the data and the picture,
which is the one place it must not be.

**The rules live in a pure function.** `board-scene.ts` turns what the server
sent into a description of what to draw and names three nowhere. jsdom has no
WebGL context, so anything asserted inside a renderer could not be tested at all
— this way every rule about what the board *shows* is provable in the same suite
as the rest of the app, and the renderer stays swappable.

### The comparison that led there

**PixiJS 8** would have been the answer for a purely top-down board.

It is the right shape for a 2D board, the incumbent's choice in this space, and
the lowest-drama option under the constraint that has hurt this project. What
decides against it is the 3D ambition: Pixi is a 2D engine, and reaching 3D from
it is a rewrite rather than a camera swap. three is one package with zero runtime
dependencies — the safest thing in the comparison under federation — and 36 KB
smaller besides.

Paperdolls remain the thing three is worst at: compositing a body, armour and a
weapon into one token is 2D sprite layering. In three that is a 2D canvas drawn
once and uploaded as a texture, which is a small utility rather than a problem —
but it is genuinely more work than `RenderTexture` would have been, and worth
saying out loud rather than discovering later.

**The hedge is real, though.** Everything the engine exposes is renderer-agnostic
— positions and footprints in half-feet, terrain and light per cell, cover as a
degree, the initiative order, the log. Nothing about the API commits to a
renderer, so a Canvas2D prototype could settle the interaction design in a day,
and be thrown away, before any of this is committed to.
