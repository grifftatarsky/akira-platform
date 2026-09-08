"""Parse the SRD 5.2.1 Equipment and Magic Items chapters into the item model.

Two extractions of the same PDF, each used where it is clean:

* `pdftotext -layout` over a whole page, for the equipment tables — they are
  full-width and their columns line up, so the layout text is the table.
* `pdftohtml -xml`, for everything with prose. It carries the font of every run,
  and the book sets item names in one distinctive face (GillSans-SemiBold 18pt,
  dark red). That is what an item heading *is*, so detecting them by font finds
  wrapped names and never mistakes a sentence for one — which reading the layout
  text cannot manage, because a magic item's name and its first line of prose
  look identical once the font is gone.
"""
import json
import os
import re
import sys

from srdtext import (
    CHAPTER,
    HEAD,
    SECTION,
    join_wrapped,
    layout,
    money,
    pounds,
    reflow,
    xml_lines,
)

PDF = os.environ.get('SRD_PDF', 'srd521.pdf')
OUT = 'items.json'

EQUIPMENT_PAGES = (89, 103)
MAGIC_PAGES = (209, 253)

MASTERIES = ('Cleave', 'Graze', 'Nick', 'Push', 'Sap', 'Slow', 'Topple', 'Vex')
DAMAGE_TYPES = ('Bludgeoning', 'Piercing', 'Slashing')


WEAPON_ROW = re.compile(
    r'^\s+(?P<name>[A-Z][\w\' -]*?)\s+(?P<dice>\d+(?:d\d+)?)\s+'
    r'(?P<dtype>%s)\s+(?P<rest>.+)$' % '|'.join(DAMAGE_TYPES))
WEAPON_TAIL = re.compile(
    r'^(?P<props>.*?)\s{2,}(?P<mastery>%s)\s+(?P<weight>.+?)\s{2,}(?P<cost>.+)$'
    % '|'.join(MASTERIES))


def parse_properties(text, weapon):
    """The Properties column into flags, ranges, and versatile damage."""
    props = set()
    for part in re.split(r',\s*(?![^()]*\))', text):
        part = part.strip()
        if not part or part == '—':
            continue
        m = re.match(r'^Ammunition \(Range (\d+)/(\d+); (\w+)\)$', part)
        if m:
            props |= {'AMMUNITION', 'RANGE'}
            weapon['rangeNormalFeet'], weapon['rangeLongFeet'] = int(m.group(1)), int(m.group(2))
            weapon['ammunition'] = m.group(3) + 's'
            # The Properties column says "Bullet" for both, and the Ammunition
            # table stocks two kinds; the weapon decides which.
            if weapon['ammunition'] == 'Bullets':
                weapon['ammunition'] = ('Bullets, Sling' if weapon['category'] == 'SIMPLE_RANGED'
                                        else 'Bullets, Firearm')
            continue
        m = re.match(r'^Thrown \(Range (\d+)/(\d+)\)$', part)
        if m:
            props.add('THROWN')
            weapon['rangeNormalFeet'], weapon['rangeLongFeet'] = int(m.group(1)), int(m.group(2))
            continue
        m = re.match(r'^Versatile \((\d+)d(\d+)\)$', part)
        if m:
            props.add('VERSATILE')
            weapon['versatileDice'] = {'count': int(m.group(1)), 'faces': int(m.group(2)),
                                       'bonus': None}
            continue
        if part.startswith('Reach'):
            props.add('REACH')
            weapon['reachFeet'] = 10
            continue
        # "Two-Handed (unless mounted)" — the Lance's exception, kept in prose.
        flag = re.sub(r'\s*\(.*\)$', '', part).upper().replace('-', '_')
        if flag in ('AMMUNITION', 'FINESSE', 'HEAVY', 'LIGHT', 'LOADING', 'RANGE',
                    'REACH', 'THROWN', 'TWO_HANDED', 'VERSATILE'):
            props.add(flag)
        else:
            raise ValueError('unknown weapon property %r' % part)
    weapon['properties'] = sorted(props)


def parse_weapons():
    text = layout(91)
    category, out, last = None, [], None
    for line in text.split('\n'):
        m = re.match(r'^\s+((?:Simple|Martial) (?:Melee|Ranged)) Weapons\s*$', line)
        if m:
            category = m.group(1).upper().replace(' ', '_')
            continue
        row = WEAPON_ROW.match(line)
        tail = WEAPON_TAIL.match(row.group('rest')) if row else None
        if not tail:
            # A wrapped Properties cell: no name, no mastery, just more properties.
            if last and re.match(r'^\s{20,}\S', line) and category:
                last['_props'] += ', ' + line.strip()
            continue
        w = {'category': category, 'ammunition': None, 'rangeNormalFeet': None,
             'rangeLongFeet': None, 'reachFeet': None, 'versatileDice': None}
        m = re.match(r'^(\d+)d(\d+)$', row.group('dice'))
        # The Blowgun deals a flat 1, not a die — a bonus with nothing to roll.
        w['dice'] = ({'count': int(m.group(1)), 'faces': int(m.group(2)), 'bonus': None}
                     if m else {'count': None, 'faces': None, 'bonus': int(row.group('dice'))})
        w['damageType'] = row.group('dtype').upper()
        w['mastery'] = tail.group('mastery')
        last = {'name': row.group('name').strip(), 'weapon': w,
                '_props': tail.group('props'),
                'weightLb': pounds(tail.group('weight')),
                'costGp': money(tail.group('cost'))}
        out.append(last)
    for item in out:
        parse_properties(item.pop('_props'), item['weapon'])
    return out


ARMOR_ROW = re.compile(
    r'^\s+(?P<name>[A-Z][\w\' -]*?)\s{2,}(?P<ac>\+?\d+(?: \+ Dex modifier(?: \(max \d+\))?)?)'
    r'\s{2,}(?P<str>Str \d+|—)\s{2,}(?P<stealth>Disadvantage|—)\s{2,}'
    r'(?P<weight>.+?)\s{2,}(?P<cost>.+)$')


def parse_armor():
    category, out = None, []
    for line in layout(92).split('\n'):
        m = re.match(r'^\s+(Light|Medium|Heavy) Armor \(', line)
        if m:
            category = m.group(1).upper()
            continue
        if re.match(r'^\s+Shield \(Utilize', line):
            category = 'SHIELD'
            continue
        row = ARMOR_ROW.match(line)
        if not row or not category:
            continue
        armor = {'category': category, 'baseArmorClass': None, 'addsDexterity': False,
                 'dexterityCap': None, 'armorClassBonus': None,
                 'strengthRequirement': None if row.group('str') == '—'
                                        else int(row.group('str').split()[1]),
                 'stealthDisadvantage': row.group('stealth') == 'Disadvantage'}
        ac = row.group('ac')
        if ac.startswith('+'):
            armor['armorClassBonus'] = int(ac[1:])
        else:
            armor['baseArmorClass'] = int(re.match(r'\d+', ac).group())
            if 'Dex modifier' in ac:
                armor['addsDexterity'] = True
                cap = re.search(r'max (\d+)', ac)
                armor['dexterityCap'] = int(cap.group(1)) if cap else None
        out.append({'name': row.group('name').strip(), 'armor': armor,
                    'weightLb': pounds(row.group('weight')),
                    'costGp': money(row.group('cost'))})
    return out


def parse_ammunition():
    out = []
    for line in layout(96, x=0, width=300).split('\n'):
        m = re.match(r'^\s+(?P<name>[A-Z][\w, ]*?)\s{2,}(?P<amount>\d+)\s+(?P<store>\w+)\s+'
                     r'(?P<weight>[\d/½ ]+lb\.)\s+(?P<cost>[\d,]+ \w\w)\s*$', line)
        if m:
            out.append({'name': m.group('name').strip(), 'amount': int(m.group('amount')),
                        'storage': m.group('store'), 'weightLb': pounds(m.group('weight')),
                        'costGp': money(m.group('cost'))})
    return out


def parse_gear_table():
    """The Adventuring Gear table: two Item/Weight/Cost blocks side by side."""
    out = []
    for x, width in ((0, 300), (300, 294)):
        for line in layout(95, x=x, width=width).split('\n'):
            m = re.match(r"^\s*(?P<name>[A-Z][\w',() ]*?)\s{2,}(?P<weight>[\d/½.]+ lb\."
                         r"(?: \(full\))?|—|Varies)\s{2,}(?P<cost>[\d,]+ \w\w|Varies)\s*$", line)
            if m:
                out.append({'name': m.group('name').strip(),
                            'weightLb': pounds(m.group('weight')),
                            'costGp': money(m.group('cost'))})
    return out


def parse_mounts():
    """Mounts, tack and vehicles: three tables, three shapes, two page columns."""
    out, section = [], None
    for line in layout(100, x=300, width=294).split('\n'):
        if line.startswith('Mounts and Other Animals'):
            section = 'animal'
            continue
        if line.startswith('Tack, Harness, and Drawn Vehicles'):
            section = 'tack'
            continue
        if line.startswith('Large Vehicles'):
            section = None
        if section == 'animal':
            m = re.match(r"^(?P<name>[A-Z][\w, ]*?)\s{2,}(?P<cap>[\d,]+) lb\.\s{2,}"
                         r"(?P<cost>[\d,]+ \w\w)\s*$", line)
            if m:
                out.append({'name': m.group('name').strip(), 'weightLb': None,
                            'costGp': money(m.group('cost')), 'kind': 'animal',
                            'description': 'This animal has a carrying capacity of %s pounds. '
                                           'See "Monsters" for its stat block.' % m.group('cap')})
        elif section == 'tack':
            m = re.match(r"^\s*(?P<name>[A-Z][\w ]*?)\s{2,}(?P<weight>[\d,]+ lb\.)\s{2,}"
                         r"(?P<cost>[\d,]+ \w\w)\s*$", line)
            # Stabling is a service, not a thing you can own, so it has no row here.
            if m and not m.group('name').startswith('Stabling'):
                name = m.group('name').strip()
                # The three saddles print indented under a "Saddle" sub-head.
                if name in ('Exotic', 'Military', 'Riding'):
                    name += ' Saddle'
                out.append({'name': name, 'weightLb': pounds(m.group('weight')),
                            'costGp': money(m.group('cost')), 'kind': 'tack',
                            'description': None})
    for line in layout(101).split('\n'):
        m = re.match(r"^\s+(?P<name>[A-Z][A-Za-z ]*?)\s{2,}(?P<speed>[\d½ ]+) mph\s+(?P<crew>\d+)"
                     r"\s+(?P<pax>[\d—]+)\s+(?P<cargo>[\d/—]+)\s+(?P<ac>\d+)\s+(?P<hp>\d+)"
                     r"\s+(?P<dt>[\d—]+)\s+(?P<cost>[\d,]+ GP)\s*$", line)
        if m:
            dash = lambda v, alt: alt if v == '—' else v
            out.append({
                'name': m.group('name').strip(), 'weightLb': None, 'kind': 'ship',
                'costGp': money(m.group('cost')),
                'description': ('Speed %s mph. Crew %s. Passengers %s. Cargo %s tons. '
                                'AC %s, HP %s. Damage threshold %s.') % (
                    m.group('speed').replace('½', ' 1/2').strip(), m.group('crew'),
                    dash(m.group('pax'), 'none'), dash(m.group('cargo'), 'none'),
                    m.group('ac'), m.group('hp'), dash(m.group('dt'), 'none'))})
    return out


def prose_entries(first, last, chapters):
    """Headed entries from a prose chapter: (chapter, section, heading, lines)."""
    entries, chapter, section, cur, prev = [], None, None, None, None
    for _page, kind, indented, _italic, text in xml_lines(first, last):
        if kind == 'chapter':
            chapter, section, cur = text, None, None
        elif kind == 'section':
            section, cur = text, None
        elif kind == 'head' and chapter in chapters:
            if cur is not None and prev == 'head':
                cur['heading'] += ' ' + text
            else:
                cur = {'chapter': chapter, 'section': section, 'heading': text, 'lines': []}
                entries.append(cur)
        elif cur is not None and kind in ('body', 'table'):
            cur['lines'].append((kind, indented, text))
        prev = kind
    return entries


HEADING_COST = re.compile(r'^(?P<name>.*?) \((?P<cost>[^()]*(?:\([^()]*\))?[^()]*)\)$')


def split_heading(heading):
    """'Alchemist’s Supplies (50 GP)' -> ("Alchemist's Supplies", 50.0)."""
    m = HEADING_COST.match(heading)
    if not m:
        return heading, None
    return m.group('name').strip(), money(m.group('cost'))


def parse_tools():
    out = []
    for e in prose_entries(93, 94, {'Tools'}):
        name, cost = split_heading(e['heading'])
        fields, prose = {}, []
        for kind, indented, line in e['lines']:
            m = re.match(r'^(Ability|Utilize|Craft|Variants):\s*(.*)$', line)
            if m:
                fields[m.group(1)] = m.group(2)
                # "Ability: Strength   Weight: 6 lb." shares one line.
                w = re.search(r'Weight:\s*(.+)$', line)
                if w:
                    fields['Ability'] = re.sub(r'\s*Weight:.*$', '', fields.get('Ability', ''))
                    fields['Weight'] = w.group(1)
            elif fields:
                # A wrapped Utilize/Craft/Variants value.
                key = list(fields)[-1] if list(fields)[-1] != 'Weight' else 'Craft'
                fields[key] = join_wrapped(fields.get(key, ''), line).strip()
            else:
                prose.append((kind, indented, line))
        out.append({
            'name': name, 'costGp': cost, 'weightLb': pounds(fields.get('Weight', '')),
            'ability': fields.get('Ability', '').strip().upper() or None,
            'utilize': fields.get('Utilize'), 'craft': fields.get('Craft'),
            'variants': fields.get('Variants'), 'prose': reflow(prose)})
    return out


def parse_gear_prose():
    out = {}
    for e in prose_entries(94, 100, {'Adventuring Gear'}):
        name, cost = split_heading(e['heading'])
        out[name] = {'costGp': cost, 'description': reflow(e['lines'])}
    return out


MAGIC_KINDS = {'Wondrous Item': 'WONDROUS_ITEM', 'Armor': 'ARMOR', 'Weapon': 'WEAPON',
               'Potion': 'POTION', 'Ring': 'RING', 'Rod': 'ROD', 'Scroll': 'SCROLL',
               'Staff': 'STAFF', 'Wand': 'WAND'}
RARITIES = ('Rarity Varies', 'Very Rare', 'Legendary', 'Artifact', 'Uncommon', 'Common', 'Rare')
RARITY_ENUM = {'Common': 'COMMON', 'Uncommon': 'UNCOMMON', 'Rare': 'RARE',
               'Very Rare': 'VERY_RARE', 'Legendary': 'LEGENDARY', 'Artifact': 'ARTIFACT',
               'Rarity Varies': 'VARIES'}
TYPE_START = re.compile(r'^(%s)\b' % '|'.join(MAGIC_KINDS))


def parse_type_line(text):
    """'Armor (Shield), Rare (Requires Attunement by a Cleric)' into its parts.

    Returns (parsed, leftover). The book runs the type line straight into the
    description when the line has room, so whatever the grammar doesn't claim is
    the first words of the prose and goes back to the caller.
    """
    m = re.match(r'^(?P<kind>%s)\s*(?:\((?P<applies>[^)]*)\))?,\s*' % '|'.join(MAGIC_KINDS), text)
    if not m:
        return None, text
    rest = text[m.end():]
    rarities = []
    while True:
        rest = re.sub(r'^(?:,\s*)?(?:or\s+)?', '', rest.strip())
        rarity = next((r for r in RARITIES if rest.startswith(r)), None)
        if not rarity:
            break
        rest = rest[len(rarity):].lstrip()
        # A parenthetical that isn't the attunement clause qualifies the rarity:
        # "Rare (+1)", "Very Rare (Bronze)".
        q = re.match(r'^\((?!Requires Attunement)([^)]*)\)\s*', rest)
        rarities.append((rarity, q.group(1) if q else None))
        if q:
            rest = rest[q.end():]
        if not re.match(r'^(?:,\s|or\s)', rest):
            break
    if not rarities:
        return None, text
    attunement, note = False, None
    a = re.match(r'^\(Requires Attunement(?P<by>[^)]*)\)\s*', rest)
    if a:
        attunement = True
        note = a.group('by').strip() or None
        rest = rest[a.end():]
    return {'kind': MAGIC_KINDS[m.group('kind')], 'appliesTo': m.group('applies'),
            'rarities': rarities, 'attunement': attunement, 'attunementNote': note}, rest


def parse_magic_items():
    items, cur, prev = [], None, None
    for _page, kind, indented, italic, text in xml_lines(*MAGIC_PAGES):
        if kind in ('chapter', 'section'):
            continue
        if kind == 'head':
            if cur is not None and prev == 'head' and not cur['_type'] and not cur['lines']:
                cur['name'] = join_wrapped(cur['name'], text)
            else:
                cur = {'name': text, '_type': '', 'lines': []}
                items.append(cur)
        elif cur is not None:
            # The type line is the run of fully italic lines under the name; the
            # description is everything after it, and starts the moment the
            # italic stops — which is the only reliable place to cut, because a
            # type line may wrap and a description may begin on the same line.
            if italic and not cur['lines'] and kind != 'table':
                cur['_type'] = join_wrapped(cur['_type'], text)
            else:
                cur['lines'].append((kind, indented, text))
        prev = kind
    for it in items:
        parsed, leftover = parse_type_line(it['_type'])
        it['type'] = parsed
        if leftover.strip():
            it['lines'].insert(0, ('body', False, leftover.strip()))
    out = []
    for it in items:
        t = it['type'] or {}
        rarities = t.get('rarities') or []
        out.append({
            'name': it['name'],
            'itemCategory': ('SHIELD' if t.get('appliesTo') == 'Shield' else t.get('kind')),
            'appliesTo': t.get('appliesTo'),
            'rarityTier': (RARITY_ENUM[rarities[0][0]] if len(rarities) == 1
                           else 'VARIES' if rarities else None),
            'rarityNote': ', '.join(
                '%s%s' % (r, ' (%s)' % q if q else '') for r, q in rarities)
                if len(rarities) > 1 else None,
            'attunement': t.get('attunement', False),
            'attunementNote': t.get('attunementNote'),
            'description': reflow(it['lines'])})
    return out


def blank(**over):
    row = {'name': None, 'itemCategory': None, 'rarityTier': None, 'rarityNote': None,
           'appliesTo': None, 'attunement': False, 'attunementNote': None, 'costGp': None,
           'weightLb': None, 'description': None, 'toolAbility': None, 'crafts': [],
           'baseOptions': [], 'weapon': None, 'armor': None, 'ammunitionItem': None,
           'source': None}
    row.update(over)
    return row


# Gear table rows the book files under a magic-item category rather than as gear.
GEAR_CATEGORY = {'Potion of Healing': 'POTION', 'Spell Scroll (Cantrip)': 'SCROLL',
                 'Spell Scroll (Level 1)': 'SCROLL'}


def listed(text):
    """'A, B (x, y), or C' -> ['A', 'B (x, y)', 'C'].

    Commas inside parentheses belong to a parenthetical, not to the list. "or"
    is left alone here: "Map or Scroll Case" is one item's name and "Maul or
    Warhammer" is two, and only the catalog knows which — see resolve_refs.
    """
    parts = [p.strip() for p in re.split(r',\s*(?![^()]*\))', text or '') if p.strip()]
    return [re.sub(r'^or\s+', '', p) for p in parts]


def base_options(applies_to):
    """The named base items in a magic item's qualifier, where it names any.

    "Weapon (Battleaxe, Greataxe, or Halberd)" enumerates three real rows and
    becomes three links; "Weapon (Any Simple or Martial)" names a category, not
    an item, and stays as the printed phrase alone.
    """
    if not applies_to or applies_to.startswith('Any'):
        return []
    return [n for n in listed(re.sub(r',?\s*Except .*$', '', applies_to))
            if not n.startswith('Any')]


def resolve_refs(items):
    """Turn the reference lists into catalog names, using the catalog to decide.

    Two things need the catalog to settle. The equipment tables index by keyword
    ("Lantern, Bullseye") while the Craft lists read naturally ("Bullseye
    Lantern"), so every comma-inverted name gets an alias. And "or" separates
    two items in "Maul or Warhammer" but sits inside one in "Map or Scroll
    Case" — so a phrase is only split on "or" when it doesn't name a row.
    """
    names = {i['name'] for i in items}
    alias = {}
    for name in names:
        if ', ' in name:
            head, tail = name.split(', ', 1)
            alias['%s %s' % (tail, head)] = name

    def resolve(ref):
        for candidate in (ref, alias.get(ref)):
            if candidate in names:
                return [candidate]
        if ' or ' in ref:
            out = []
            for part in ref.split(' or '):
                out += resolve(part.strip())
            if out:
                return out
        return [ref]

    for item in items:
        for key in ('crafts', 'baseOptions'):
            item[key] = [r for ref in item[key] for r in resolve(ref)]


def main():
    items = []

    for w in parse_weapons():
        weapon = w['weapon']
        ammo = weapon.pop('ammunition')
        items.append(blank(name=w['name'], itemCategory='WEAPON', costGp=w['costGp'],
                           weightLb=w['weightLb'], weapon=weapon, ammunitionItem=ammo,
                           source='weapons table'))

    for a in parse_armor():
        items.append(blank(name=a['name'], weightLb=a['weightLb'], costGp=a['costGp'],
                           armor=a['armor'], source='armor table',
                           itemCategory='SHIELD' if a['armor']['category'] == 'SHIELD'
                                        else 'ARMOR'))

    for a in parse_ammunition():
        items.append(blank(
            name=a['name'], itemCategory='AMMUNITION', costGp=a['costGp'],
            weightLb=a['weightLb'], source='ammunition table',
            description='Sold in lots of %d, stored in a %s.' % (a['amount'], a['storage'])))

    for t in parse_tools():
        parts = []
        for label, value in (('Utilize', t['utilize']), ('Craft', t['craft']),
                             ('Variants', t['variants'])):
            if value:
                parts.append('%s: %s' % (label, value))
        if t['prose']:
            parts.insert(0, t['prose'])
        items.append(blank(name=t['name'], itemCategory='TOOL', costGp=t['costGp'],
                           weightLb=t['weightLb'], toolAbility=t['ability'],
                           description='\n\n'.join(parts) or None, source='tools',
                           crafts=listed(t['craft'])))

    prose = parse_gear_prose()
    for g in parse_gear_table():
        # The two Spell Scroll rows share one description, headed by the stem.
        entry = prose.get(g['name']) or prose.get(g['name'].split(' (')[0], {})
        items.append(blank(name=g['name'], costGp=g['costGp'], weightLb=g['weightLb'],
                           description=entry.get('description'), source='adventuring gear',
                           itemCategory=GEAR_CATEGORY.get(g['name'], 'ADVENTURING_GEAR')))

    for m in parse_mounts():
        items.append(blank(name=m['name'], itemCategory='MOUNT_OR_VEHICLE', costGp=m['costGp'],
                           weightLb=m['weightLb'], description=m['description'],
                           source='mounts and vehicles'))

    for m in parse_magic_items():
        items.append(blank(name=m['name'], itemCategory=m['itemCategory'],
                           rarityTier=m['rarityTier'], rarityNote=m['rarityNote'],
                           appliesTo=m['appliesTo'], attunement=m['attunement'],
                           attunementNote=m['attunementNote'], description=m['description'],
                           baseOptions=base_options(m['appliesTo']), source='magic items'))

    resolve_refs(items)

    names = [i['name'] for i in items]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        print('duplicate names:', dupes, file=sys.stderr)
    json.dump(items, open(OUT, 'w'), indent=1)
    print('%s: %d items' % (OUT, len(items)))
    by_source = {}
    for i in items:
        by_source[i['source']] = by_source.get(i['source'], 0) + 1
    for k, v in by_source.items():
        print('  %-22s %4d' % (k, v))


if __name__ == '__main__':
    main()
