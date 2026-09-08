"""Parse the SRD 5.2.1 Classes chapter into the vocation model.

Twelve classes, each printed the same way: a Core Traits table, a twenty-row
Features table, a run of `Level N: Name` features, one subclass, and — for the
seven casters — a spell list. The chapter is 55 pages and entirely regular, so
this is transcription rather than interpretation.

Headings come from the font (see `srdtext`), which is what separates a class
name from a section from a feature: 27pt, 21pt and 18pt of the same face.
"""
import json
import re
import sys

from srdtext import CHAPTER, SECTION, join_wrapped, reflow, xml_cells, xml_lines

OUT = 'classes.json'
CLASS_PAGES = (28, 82)

# The label column of every Core X Traits table, in the order the book prints
# them. Wrapped labels ("Saving Throw" / "Proficiencies") join on the first word.
CORE_LABELS = ('Primary Ability', 'Hit Point Die', 'Saving Throw Proficiencies',
               'Skill Proficiencies', 'Tool Proficiencies', 'Weapon Proficiencies',
               'Armor Training', 'Starting Equipment')

ABILITIES = {'Strength': 'STRENGTH', 'Dexterity': 'DEXTERITY', 'Constitution': 'CONSTITUTION',
             'Intelligence': 'INTELLIGENCE', 'Wisdom': 'WISDOM', 'Charisma': 'CHARISMA'}
SKILLS = {'Acrobatics': 'ACROBATICS', 'Animal Handling': 'ANIMAL_HANDLING', 'Arcana': 'ARCANA',
          'Athletics': 'ATHLETICS', 'Deception': 'DECEPTION', 'History': 'HISTORY',
          'Insight': 'INSIGHT', 'Intimidation': 'INTIMIDATION', 'Investigation': 'INVESTIGATION',
          'Medicine': 'MEDICINE', 'Nature': 'NATURE', 'Perception': 'PERCEPTION',
          'Performance': 'PERFORMANCE', 'Persuasion': 'PERSUASION', 'Religion': 'RELIGION',
          'Sleight of Hand': 'SLEIGHT_OF_HAND', 'Stealth': 'STEALTH', 'Survival': 'SURVIVAL'}

LEVEL_FEATURE = re.compile(r'^Level (\d+):\s*(.+)$')


def class_sections(first, last):
    """The chapter as (class name, [(kind, page, indented, text)]) per class."""
    classes, current, pending_section = [], None, None
    for page, kind, indented, _italic, text in xml_lines(first, last):
        if kind == 'chapter':
            if text == 'Classes':
                continue
            current = {'name': text, 'page': page, 'lines': []}
            classes.append(current)
            pending_section = None
            continue
        if current is None:
            continue
        if kind == 'section':
            # A subclass heading wraps, sometimes twice: "Monk Subclass:" /
            # "Warrior of the" / "Open Hand". Consecutive section lines belong
            # to one heading whenever the run started with a subclass.
            if pending_section is not None:
                pending_section += ' ' + text
                current['lines'][-1] = ('section', page, indented, pending_section)
                continue
            pending_section = text if 'Subclass:' in text else None
        else:
            pending_section = None
        current['lines'].append((kind, page, indented, text))
    return classes


def parse_features(lines):
    """`Level N: Name` blocks, split into class features and subclass features.

    The subclass heading is a section, so everything after it belongs to the
    subclass — which is how the book reads and the only thing that separates a
    Champion's features from a Fighter's.
    """
    features, subclass, current = [], None, None
    in_subclass = False
    for kind, _page, indented, text in lines:
        if kind == 'section':
            m = re.match(r'^(.+?) Subclass:\s*(.+)$', text)
            if m:
                in_subclass = True
                subclass = {'name': m.group(2).strip(), 'lines': [], 'features': []}
                current = None
            else:
                in_subclass = False
                current = None
            continue
        if kind == 'head':
            m = LEVEL_FEATURE.match(text)
            if m:
                current = {'level': int(m.group(1)), 'name': m.group(2).strip(), 'lines': []}
                (subclass['features'] if in_subclass else features).append(current)
            else:
                # "As a Level 1 Character" and the like: prose, not a feature.
                current = None
            continue
        if current is not None:
            current['lines'].append((kind, indented, text))
        elif in_subclass and subclass is not None and not subclass['features']:
            subclass['lines'].append((kind, indented, text))
    for f in features:
        f['description'] = reflow(f.pop('lines'))
    if subclass:
        subclass['description'] = reflow(subclass.pop('lines'))
        for f in subclass['features']:
            f['description'] = reflow(f.pop('lines'))
    return features, subclass


def parse_level_table(name, first_page, last_page):
    """The twenty-row `X Features` table.

    Read from positioned cells rather than from rendered text: the Class
    Features cell wraps, a class column can hold a value with a space in it
    ("+30 ft."), and a column label can wrap onto two lines ("Rage" above
    "Damage"). All three defeat splitting a rendered row on whitespace; none of
    them touches a run's x offset.
    """
    rows, header, above, labels = [], None, None, []
    for _page, _col, _top, cells in xml_cells(first_page, last_page, split_columns=False):
        texts = [c[2] for c in cells]
        if header is None:
            if texts[:1] == ['Level'] and 'Class Features' in texts:
                header = cells
            else:
                above = cells  # the upper half of any two-line column labels
            continue
        if texts[0].isdigit() and 1 <= int(texts[0]) <= 20:
            rows.append(cells)
        elif rows and len(texts) == 1:
            # A wrapped Class Features cell — "Bardic Inspiration," / "Spellcasting".
            rows[-1] = _merge_wrapped(rows[-1], cells[0])
        if len(rows) == 20:
            break

    if header is None:
        return [], []
    # Column labels: the leaf line, prefixed by whatever sits directly above it.
    for left, right, text, _spec in header[3:]:
        # A spell-slot column is named by its level alone; the "Spell Slots per
        # Spell Level" banner above the first of them is a caption, not a label.
        prefix = None if text.isdigit() else next(
            (t for l, r, t, _ in (above or []) if abs(l - left) < 12), None)
        labels.append(('%s %s' % (prefix, text)) if prefix else text)

    slot_start = next((i for i, l in enumerate(labels) if l.isdigit()), len(labels))
    out = []
    for cells in rows:
        values = [c[2] for c in cells[3:]]
        # A class column holds one cell, spaces and all ("+30 ft."). The spell
        # slot band is the opposite: a run of single tokens the typesetter may
        # have emitted as one run ("2 — — — — — — — —"), so it is tokenised.
        slot_tokens = [t for v in values[slot_start:] for t in v.split()]
        out.append({
            'level': int(cells[0][2]),
            'proficiencyBonus': int(cells[1][2].lstrip('+')),
            'features': cells[2][2],
            'values': dict(zip(labels[:slot_start], values[:slot_start])),
            'slots': dict(zip(labels[slot_start:], slot_tokens)),
        })
    return out, labels


def _merge_wrapped(row, cell):
    """Append a wrapped Class Features line to the row above it."""
    merged = list(row)
    left, right, text, spec = merged[2]
    merged[2] = (left, right, (text + ' ' + cell[2]).strip(), spec)
    return merged


def parse_core_traits(name, first_page, last_page):
    """The `Core X Traits` table: a label/value list in one of the page columns.

    Both halves wrap. A continuation sits at the label's x or the value's x, and
    that offset is the only thing that says which — the rendered text gives a
    bare line either way. Half the classes start at the foot of a page, so the
    table is looked for across the class's first two pages and in whichever
    column it turns out to be in.
    """
    traits, label, label_x = {}, None, None
    where = None
    for page, col, _top, cells in xml_cells(first_page, last_page):
        texts = [c[2] for c in cells]
        if where is None:
            if texts[:1] == ['Core %s Traits' % name]:
                where = (page, col)
            continue
        if (page, col) != where:
            continue
        # The Features table can start on the same page and its title sits in
        # the label column, so stop at the next heading of any level.
        if cells[0][3] in (SECTION, CHAPTER) or texts[0] == '%s Features' % name:
            break
        # A row starting in the label column begins a new trait; anything else
        # continues the one above, however many runs it was broken into. Cell
        # count can't tell them apart — the Monk's tools wrap onto a line that
        # is itself two runs.
        starts_trait = label_x is None or abs(cells[0][0] - label_x) < 12
        if starts_trait and len(cells) >= 2:
            label, label_x = texts[0], cells[0][0]
            traits[label] = ' '.join(texts[1:])
        elif starts_trait and label is not None:
            # A label that wrapped: "Saving Throw" / "Proficiencies".
            traits['%s %s' % (label, texts[0])] = traits.pop(label)
            label = '%s %s' % (label, texts[0])
        elif label is not None:
            traits[label] = join_wrapped(traits[label], ' '.join(texts))
    return traits


SPELL_TABLE_HEAD = ('Spell', 'School', 'Special')


def parse_spell_list(name, lines_pages):
    """A caster's spell list: the names under `X Spell List`.

    Only the names are taken. School, Concentration and Ritual already live on
    the spell row itself, and re-importing them here would be a second copy of
    the same facts with nothing keeping them equal.
    """
    first, last = lines_pages
    spells, reading = [], False
    for _page, _col, _top, cells in xml_cells(first, last):
        texts = [c[2] for c in cells]
        if cells[0][3] in (SECTION, CHAPTER):
            reading = texts[0] == '%s Spell List' % name
            continue
        if not reading:
            continue
        if texts[:3] == list(SPELL_TABLE_HEAD) or texts[:1] == ['Spell']:
            continue
        # A spell row is a name, a school, and the Special column's C/R/M or a
        # dash. Anything else on these pages is the section's prose.
        if len(cells) >= 2 and re.match(r'^[A-Z]', texts[0]) and texts[1] in SCHOOLS:
            spells.append(texts[0])
    return spells


SCHOOLS = {'Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation',
           'Illusion', 'Necromancy', 'Transmutation'}


def parse_abilities(text):
    return [ABILITIES[w] for w in re.findall(r'\b\w+\b', text or '') if w in ABILITIES]


def parse_skills(text):
    """'Choose 2: Animal Handling, Athletics, or Survival' -> (2, [...]).

    'Choose any 3 skills' means every skill is on offer, which is a real
    difference from a list of three and has to survive as one.
    """
    if not text:
        return None, []
    count = re.search(r'Choose (?:any )?(\d+)', text)
    n = int(count.group(1)) if count else None
    if re.search(r'Choose any \d+ skills', text):
        return n, sorted(SKILLS.values())
    listed = text.split(':', 1)[1] if ':' in text else ''
    found = [SKILLS[s] for s in SKILLS if re.search(r'\b%s\b' % re.escape(s), listed)]
    return n, sorted(found)


def caster_progression(labels, levels):
    """Which spell-slot table a class uses, read off the table's own columns."""
    slot_columns = [l for l in labels if l.isdigit()]
    if 'Spell Slots' in labels and 'Slot Level' in labels:
        return 'PACT'
    if len(slot_columns) >= 9:
        return 'FULL'
    if slot_columns:
        return 'HALF'
    return 'NONE'


def spellcasting_ability(features):
    for f in features:
        # "Charisma is your spellcasting ability" for eleven classes, and "is the
        # spellcasting ability for your Warlock spells" for the twelfth.
        m = re.search(r'(\w+) is (?:your|the) spellcasting ability', f['description'] or '')
        if m and m.group(1) in ABILITIES:
            return ABILITIES[m.group(1)]
    return None


def main():
    classes = class_sections(*CLASS_PAGES)
    out = []
    for i, c in enumerate(classes):
        last = classes[i + 1]['page'] if i + 1 < len(classes) else CLASS_PAGES[1]
        traits = parse_core_traits(c['name'], c['page'], min(c['page'] + 2, last))
        levels, labels = parse_level_table(c['name'], c['page'], min(c['page'] + 3, last + 1))
        features, subclass = parse_features(c['lines'])
        hit_die = re.search(r'D(\d+)', traits.get('Hit Point Die', '') or '')
        skill_choices, skill_options = parse_skills(traits.get('Skill Proficiencies'))
        out.append({
            'name': c['name'],
            'hitDie': int(hit_die.group(1)) if hit_die else None,
            'primaryAbilities': parse_abilities(traits.get('Primary Ability')),
            'savingThrowProficiencies': parse_abilities(traits.get('Saving Throw Proficiencies')),
            'skillChoices': skill_choices,
            'skillOptions': skill_options,
            'weaponProficiencies': traits.get('Weapon Proficiencies'),
            'toolProficiencies': traits.get('Tool Proficiencies'),
            'armorTraining': traits.get('Armor Training'),
            'startingEquipment': traits.get('Starting Equipment'),
            'casterProgression': caster_progression(labels, levels),
            'spellcastingAbility': spellcasting_ability(features),
            'levels': levels,
            'features': features,
            'subclass': subclass,
            'spellList': parse_spell_list(c['name'], (c['page'], last)),
        })

    problems = []
    for c in out:
        if len(c['levels']) != 20:
            problems.append('%s has %d level rows' % (c['name'], len(c['levels'])))
        if not c['hitDie'] or not c['primaryAbilities'] or not c['savingThrowProficiencies']:
            problems.append('%s is missing a core trait' % c['name'])
        if c['casterProgression'] != 'NONE' and not c['spellcastingAbility']:
            problems.append('%s casts but has no spellcasting ability' % c['name'])
        if not c['subclass']:
            problems.append('%s has no subclass' % c['name'])
    for p in problems:
        print(p, file=sys.stderr)

    json.dump(out, open(OUT, 'w'), indent=1)
    print('%s: %d classes, %d levels, %d features, %d subclass features, %d spell links'
          % (OUT, len(out), sum(len(c['levels']) for c in out),
             sum(len(c['features']) for c in out),
             sum(len(c['subclass']['features']) for c in out if c['subclass']),
             sum(len(c['spellList']) for c in out)), file=sys.stderr)


if __name__ == '__main__':
    main()
