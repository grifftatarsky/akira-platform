# SRD load data

The CSVs the `029`-`036` changesets load, and the scripts that produce them from
the SRD 5.2.1 PDF. `srdtext.py` is the shared reader every parser uses; the three
ways it gets text out of the book, and when each one is right, are documented at
the top of it.

Keep the scripts with the data. The CSVs are generated, and the only way to
review a correction to one of them — or to re-derive the lot when the book is
revised — is to be able to run the thing that wrote them.

Ids are UUIDv5 of the row's name, so a re-run is byte-identical and a parser fix
shows up as a diff on the rows it touched rather than as 3,000 new ids.
**Changing a CSV after its changeset has been applied anywhere will fail
Liquibase's checksum** — correct data in a new changeset instead.

```
curl -o srd521.pdf https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf
```

## Bestiary — `029`

```
for p in $(seq 258 364); do
  pdftotext -layout -f $p -l $p -x 0   -y 0 -W 300 -H 783 srd521.pdf - >> mon521full.txt
  pdftotext -layout -f $p -l $p -x 300 -y 0 -W 294 -H 783 srd521.pdf - >> mon521full.txt
done
python3 parse-bestiary.py   # -> bestiary.json
python3 emit-bestiary.py    # -> the CSVs beside this file
```

Two columns must be extracted separately: `pdftotext -layout` interleaves them
and the result is unparseable.

### Coverage, measured against the source text

| | in the book | imported |
|---|---|---|
| stat blocks | 330 | 330 |
| `Attack Roll:` | 423 | 422 |
| saving throws (any phrasing) | 206 | 200 |
| `(Recharge N-N)` | 87 | 86 |
| `(N/Day)` | 60 | 59 |
| `Success: Half damage` | 80 | 80 |
| `has the X condition` | 222 | 210 |
| Skills / Senses / Gear / Immunities lines | all | all |

A feature resolves as an ordered list of `feature_steps` (created in `027` with
the rest of the rules model), so a chained
attack-then-save — the Cockatrice's bite, which hits and *then* asks for a
Constitution save — keeps both rolls rather than collapsing to the first. Every
feature also keeps the book's sentence in `description`, and an effect keeps
anything the columns couldn't hold in `notes`.

### Multiattack

178 creatures have one, and it is the action most of them take every turn. It
parses into `feature_components`, which point at the creature's other features:

| | count |
|---|---|
| Multiattack features | 178 |
| structured | 177 |
| components | 324 |

`mode` is what makes them executable rather than decorative. Half the book's
Multiattacks are not a fixed list:

* `FIXED` — "makes two Rend attacks" (175 components)
* `CHOICE` — "three attacks, using Shortsword or Light Crossbow in any
  combination" (93). Every member of a choice group carries the same count: it
  is the whole allowance, not a per-member limit. Read additively this is six
  attacks instead of three.
* `REPLACEMENT` — "it can replace one attack with a use of Spellcasting" (53).
  Swaps an attack out; adds nothing to the total.
* `ALTERNATIVE` — the Barbed Devil's "or it makes two Hurl Flame attacks" (3).

The one creature left unstructured is the Hydra: "as many Bite attacks as it has
heads" has no fixed count, and reading five off its Multiple Heads trait would
be our number rather than the book's. Its sentence is still in `description`.

## Equipment and magic items — `031`

```
python3 parse-items.py   # -> items.json   (shells out to pdftotext/pdftohtml)
python3 emit-items.py    # -> 031/*.csv
```

`parse-items.py` does its own extraction, both ways, each where it is clean:

* `pdftotext -layout` over a whole page for the equipment **tables** — they are
  full-width and their columns line up, so the layout text *is* the table.
* `pdftohtml -xml` for everything with **prose**. It carries the font of every
  run, and the book sets item names in one distinctive face (GillSans-SemiBold
  18pt, dark red). That is what an item heading *is*, so detecting them by font
  finds wrapped names and never mistakes a sentence for one — which reading the
  layout text cannot manage, because a magic item's name and its first line of
  prose look identical once the font is gone. The same trick bounds a magic
  item's type line, which is the only fully italic line in an entry, and keeps
  tables (GillSans) from being reflowed into the prose (Cambria) around them.

### What lands

| source | pages | rows |
|---|---|---|
| Weapons table | 91 | 38 |
| Armor table | 92 | 12 + Shield |
| Tools | 93–94 | 17 artisan's + 8 other |
| Adventuring Gear table + descriptions | 94–100 | 82 |
| Ammunition table | 96 | 5 |
| Mounts, tack and vehicles | 100–101 | 24 |
| Magic Items A–Z | 209–253 | 253 |
| | | **440** |

Cross-references become foreign keys rather than staying prose: a tool's Craft
list (`item_crafts`, 94 links), a magic item's base-item options
(`item_base_options`, 73 links over 34 items), and the ammunition a ranged
weapon spends (`items.ammunition_id`). The book's phrasing needs the catalog to
resolve either one — the equipment tables index by keyword ("Lantern, Bullseye")
while the Craft lists read naturally ("Bullseye Lantern"), and "or" separates two
items in "Maul or Warhammer" but sits inside one in "Map or Scroll Case".

`031` also re-runs `029`'s bestiary gear join, which could link four of its 100
Gear lines when it was written and now links 98. The two that remain are a plain
"Wand", which is not an item in the book: Magic Items A–Z has thirteen specific
wands and no generic one.

## Species — `035`

```
python3 parse-species.py    # -> species.json
python3 emit-rules.py       # -> 033/, 034/, 035/, 036/
```

Nine species on pp. 83-86: 33 named traits, plus 8 options nested in two of
them. The book ranks a trait above an option by the type it sets them in — a
trait's name is bold *and* italic, an option's is bold alone — and that is the
only signal, so `srdtext` reports both. The options join their parent by a
CHOICE component: a Goliath takes one giant ancestry of six, not all six.

## Gameplay Toolbox — `036`

```
python3 parse-toolbox.py    # -> toolbox.json
python3 emit-rules.py
```

Most of pp. 192-208 is procedure — budgeting an encounter, building a background
— and is not catalog content. Four things in it are:

| | count | lands in |
|---|---|---|
| sample poisons | 14 | `items`, category POISON, priced per dose |
| example traps | 8 | `traps` |
| magical contagions | 3 | `glossary_entries`, category CONTAGION |
| environmental effects | 9 | `glossary_entries`, category ENVIRONMENT |

## Rules Glossary — `033`

```
python3 parse-glossary.py   # -> glossary.json
python3 emit-rules.py       # -> 033/*.csv and 034/*.csv
```

155 entries on pp. 176-191, found by font like everything else with prose. 140
become glossary rows; the other 15 are the [Condition] entries, which already
have rows of their own because an effect points at a condition by id — so those
refresh `conditions.description` on a name join rather than storing the same
rule in two tables that could then drift.

The book's other bracketed tags become `glossary_entries.category`: 12 [Action],
6 [Area of Effect], 5 [Hazard], 3 [Attitude], and 114 plain terms.

## Classes — `034`

```
python3 parse-classes.py    # -> classes.json
python3 emit-rules.py       # -> 034/*.csv
```

Twelve classes on pp. 28-82, each printed identically: a Core Traits table, a
twenty-row Features table, `Level N: Name` features, one subclass, and — for the
eight casters — a spell list.

| | count |
|---|---|
| classes | 12 |
| level rows | 240 |
| class features | 174 |
| subclass features | 58 |
| subclasses | 12 |
| spell/class links | 875 |

Three things the rendered text can't give you, and the positioned cells can:

* the Class Features cell **wraps**, so a row can't be split on whitespace;
* a class column can hold a value with a space in it (the Monk's `+30 ft.`);
* a column label can wrap onto two lines — `Rage` above `Damage` — so the label
  is read by joining the header line with whatever sits directly above it.

The columns no other class has (Rages, Sneak Attack, Focus Points, Martial Arts)
are an ordered list of label/value pairs rather than a column per class, which
would mean a migration every time a class is added, homebrew included.

### Coverage, measured against the book

Every feature named in a class's Features table resolves to a parsed feature —
that is the check that the feature extraction is complete, and it passes for all
twelve once the book's own parentheticals are stripped (`Action Surge (two
uses)` is level 17's cell for the feature defined at level 2; the cell is kept
in `vocation_levels.feature_summary`, which is the only place that escalation is
recorded). All 875 spell names on the eight class lists resolve to one of the
339 seeded spells.

### Known gaps

* **Weapons, armor and most tack carry no `description`.** That is the book:
  the Weapons table *is* the entry for a Longsword. A generated sentence
  restating the columns would be our words, not the book's, so the column is
  null and the UI renders the structured row.
* **Magic item text is prose, not features.** A stat block is a formal grammar
  and parses into `features`/`feature_steps`; a magic item description is not,
  and turning "you can expend 1 charge to cast Polymorph" into an effect tree
  would be interpretation rather than transcription. The prose is kept whole.
* **Lifestyle expenses, food, lodging, hirelings and spellcasting services** are
  prices for services, not things you can own, and have no item rows.
* **A class's starting equipment is prose.** "Choose A or B: (A) Greataxe, 4
  Handaxes, Explorer's Pack, and 15 GP; or (B) 75 GP" is a choice between
  bundles, which needs an equipment-choice model rather than an item list.
* **Weapon proficiency is prose too.** The Rogue's is "Simple weapons and
  Martial weapons that have the Finesse or Light property" — a rule about
  properties, not a list. Armor training *is* structured, because those four
  values map onto `ArmorCategory` exactly.
* **Four of a tool's Craft entries name a category, not a row** ("Any Melee
  weapon (except Club, Greatclub, Quarterstaff, and Whip)", "Heavy armor"), so
  they stay in the description and link to nothing.
* **Line-break hyphens are closed up unless a digit precedes them.** Measured
  over both chapters: 7 digit-led ("a 40-foot radius", kept) against 332
  word-led ("be-comes", closed). Of those 332 a handful are real compounds
  ("non-magical", "trap-door"), which still read correctly closed up.
