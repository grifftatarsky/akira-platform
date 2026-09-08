"""Parse the SRD 5.2.1 bestiary into the Oozengine rules model.

Reads the column-extracted text of the Monsters A-Z and Animals chapters and
produces one record per stat block, with features and effects structured the way
`features` / `effects` store them.

The 2024 stat block is a fixed template, so this is transcription rather than
interpretation. Where a sentence carries more than the columns can, the sentence
is kept verbatim in the feature's description and in an effect's notes — nothing
from the book is discarded.
"""
import json
import os
import re
import sys

SRC = 'mon521full.txt'
OUT = 'bestiary.json'

SIZES = ('Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan')
ABILITIES = ('Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha')
ABILITY_NAMES = {'Str': 'STRENGTH', 'Dex': 'DEXTERITY', 'Con': 'CONSTITUTION',
                 'Int': 'INTELLIGENCE', 'Wis': 'WISDOM', 'Cha': 'CHARISMA'}
DAMAGE_TYPES = ('Acid', 'Bludgeoning', 'Cold', 'Fire', 'Force', 'Lightning', 'Necrotic',
                'Piercing', 'Poison', 'Psychic', 'Radiant', 'Slashing', 'Thunder')
CONDITIONS = ('Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled',
              'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone',
              'Restrained', 'Stunned', 'Unconscious')
SENSES = ('Blindsight', 'Darkvision', 'Tremorsense', 'Truesight')
SKILLS = {'Acrobatics': 'ACROBATICS', 'Animal Handling': 'ANIMAL_HANDLING', 'Arcana': 'ARCANA',
          'Athletics': 'ATHLETICS', 'Deception': 'DECEPTION', 'History': 'HISTORY',
          'Insight': 'INSIGHT', 'Intimidation': 'INTIMIDATION', 'Investigation': 'INVESTIGATION',
          'Medicine': 'MEDICINE', 'Nature': 'NATURE', 'Perception': 'PERCEPTION',
          'Performance': 'PERFORMANCE', 'Persuasion': 'PERSUASION', 'Religion': 'RELIGION',
          'Sleight of Hand': 'SLEIGHT_OF_HAND', 'Stealth': 'STEALTH', 'Survival': 'SURVIVAL'}
SECTIONS = {'Traits': 'PASSIVE', 'Actions': 'ACTION', 'Bonus Actions': 'BONUS_ACTION',
            'Reactions': 'REACTION', 'Legendary Actions': 'LEGENDARY'}

SIZE_ALT = r'(?:%s)(?: or (?:%s))?' % ('|'.join(SIZES), '|'.join(SIZES))
HEADER = re.compile(
    r'^(%s) (Swarm of \w+ )?(\w+)(?: \(([^)]+)\))?, (.+)$' % SIZE_ALT)
DICE = r'(\d+) \((\d+d\d+(?: [+-] \d+)?)\)'


def norm(text):
    text = text.replace('\x0c', '')
    for a, b in (('−', '-'), ('–', '-'), ('—', '-'), ('’', "'"),
                 ('‘', "'"), ('“', '"'), ('”', '"'), (' ', ' ')):
        text = text.replace(a, b)
    return text


def load_lines():
    raw = norm(open(SRC, encoding='utf-8', newline='\n').read())
    return [re.sub(r'[ \t]+', ' ', l).strip() for l in raw.split('\n')]


def split_dice(expr):
    """'2d6 + 5' -> (2, 6, 5)."""
    m = re.match(r'(\d+)d(\d+)(?: ([+-]) (\d+))?', expr)
    if not m:
        return None, None, None
    bonus = int(m.group(4)) * (-1 if m.group(3) == '-' else 1) if m.group(4) else None
    return int(m.group(1)), int(m.group(2)), bonus


def parse_speeds(line):
    speeds, hover = {}, False
    if 'hover' in line:
        hover = True
    walk = re.match(r'Speed (\d+) ?ft', line)
    if walk:
        speeds['WALK'] = int(walk.group(1))
    for mode, key in (('Burrow', 'BURROW'), ('Climb', 'CLIMB'), ('Fly', 'FLY'), ('Swim', 'SWIM')):
        m = re.search(r'%s (\d+) ?ft' % mode, line, re.I)
        if m:
            speeds[key] = int(m.group(1))
    return speeds, hover


def parse_damage_list(text):
    """'Poison, Thunder; Exhaustion, Grappled' -> (damage types, condition names).

    The semicolon separates damage from conditions, but a creature immune only
    to conditions has no semicolon at all — so when there isn't one, classify
    each name on its own rather than assuming the whole line is damage.
    """
    if ';' in text:
        dmg_part, _, cond_part = text.partition(';')
    else:
        dmg_part = cond_part = text
    dmg = [d for d in DAMAGE_TYPES if re.search(r'\b%s\b' % d, dmg_part)]
    conds = [c for c in CONDITIONS if re.search(r'\b%s\b' % c, cond_part)]
    return dmg, conds


def feature_starts(body):
    """Line indexes where a feature begins.

    A feature's name is bold in the book and starts a paragraph, which after
    text extraction means: it begins a line, and the line before it is blank, a
    section heading, or the end of a sentence. Requiring the line start is what
    separates 'Air Form. The elemental...' from '...stop there. It can move',
    which is the same shape in the middle of a line.
    """
    out = []
    for i, l in enumerate(body):
        m = re.match(r"^([A-Z][A-Za-z'()/\d, +-]{0,60}?)\.\s+(?=[A-Z0-9])", l)
        if not m:
            continue
        name = m.group(1)
        if len(name.split()) > 8:
            continue
        prev = body[i - 1].strip() if i else ''
        # A colon ends a clause, not a paragraph: "Fire Breath (Recharge 5-6).
        # Dexterity Saving Throw:" wraps, and the next line starting "DC 21,
        # each creature in a 60-foot Cone." is that same feature continuing.
        if prev and prev not in SECTIONS and not re.search(r'[.!?]$', prev):
            continue
        out.append((i, name, l[m.end():]))
    return out


def parse_uses(name):
    """'Dominate Mind (2/Day)' -> ('Dominate Mind', reset, max, recharge range)."""
    m = re.match(r'^(.*?)\s*\((.*)\)\s*$', name)
    if not m:
        return name, 'AT_WILL', None, None, None
    base, note = m.group(1), m.group(2)
    rec = re.search(r'Recharge (\d)\s*-\s*(\d)', note)
    if rec:
        return base, 'RECHARGE', 1, int(rec.group(1)), int(rec.group(2))
    rec1 = re.search(r'Recharge (\d)\b', note)
    if rec1:
        return base, 'RECHARGE', 1, int(rec1.group(1)), 6
    day = re.search(r'(\d+)/Day', note)
    if day:
        return base, 'PER_DAY', int(day.group(1)), None, None
    if 'Recharges after a Short or Long Rest' in note:
        return base, 'SHORT_REST', 1, None, None
    if 'Recharges after a Long Rest' in note:
        return base, 'LONG_REST', 1, None, None
    return base, 'AT_WILL', None, None, None


ATTACK = re.compile(
    r'(?P<kind>Melee or Ranged|Melee|Ranged) Attack Roll: \+(?P<bonus>\d+)'
    r'(?:\s*\([^)]*\))?,\s*(?P<reach>[^.]*?)\.')

SAVE = re.compile(
    r'(?P<ability>Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) '
    r'Saving Throw: DC (?P<dc>\d+)(?P<targets>[^.]*)\.')


OUTCOMES = [
    ('Failure by 5 or More', 'FAILURE_BY_5_OR_MORE'),
    ('Failure or Success', 'SAVE_EITHER'),
    ('Subsequent Failures', 'SUBSEQUENT_FAILURES'),
    ('First Failure', 'FIRST_FAILURE'),
    ('Second Failure', 'SECOND_FAILURE'),
    ('Hit or Miss', 'HIT_OR_MISS'),
    ('Failure', 'SAVE_FAILURE'),
    ('Success', 'SAVE_SUCCESS'),
    ('Miss', 'MISS'),
    ('Hit', 'HIT'),
]
OUTCOME_RE = re.compile(r'\b(%s):' % '|'.join(label for label, _ in OUTCOMES))
DELIVERY_RE = re.compile(
    r'((?:Melee or Ranged|Melee|Ranged) Attack Roll:'
    r'|(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:)')


def damage_effects(segment, outcome):
    out = []
    for m in re.finditer(DICE + r' (\w+) damage', segment):
        if m.group(3) not in DAMAGE_TYPES:
            continue
        count, faces, bonus = split_dice(m.group(2))
        out.append({'outcome': outcome, 'kind': 'DAMAGE', 'diceCount': count, 'diceFaces': faces,
                    'diceBonus': bonus, 'diceAverage': int(m.group(1)),
                    'damageType': m.group(3).upper(), 'halfDamage': False,
                    'conditionName': None, 'escapeDc': None, 'notes': None})
    return out


def condition_effects(segment, outcome):
    out = []
    esc = re.search(r'escape DC (\d+)', segment)
    for m in re.finditer(r'has the (%s) condition' % '|'.join(CONDITIONS), segment):
        out.append({'outcome': outcome, 'kind': 'APPLY_CONDITION', 'diceCount': None,
                    'diceFaces': None, 'diceBonus': None, 'diceAverage': None, 'damageType': None,
                    'halfDamage': False, 'conditionName': m.group(1),
                    'escapeDc': int(esc.group(1)) if esc else None, 'notes': None})
    return out


def branch_effects(text):
    """Effects per labelled outcome branch within one resolution step."""
    marks = [(m.start(), m.group(1)) for m in OUTCOME_RE.finditer(text)]
    effects = []
    if not marks:
        return damage_effects(text, 'ALWAYS') + condition_effects(text, 'ALWAYS')
    for i, (pos, label) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        seg = text[pos + len(label) + 1:end]
        outcome = dict(OUTCOMES)[label]
        if outcome == 'SAVE_SUCCESS' and re.search(r'Half damage', seg, re.I):
            effects.append({'outcome': outcome, 'kind': 'DAMAGE', 'diceCount': None,
                            'diceFaces': None, 'diceBonus': None, 'diceAverage': None,
                            'damageType': None, 'halfDamage': True, 'conditionName': None,
                            'escapeDc': None, 'notes': None})
            continue
        effects += damage_effects(seg, outcome) + condition_effects(seg, outcome)
    return effects


def parse_steps(text):
    """One resolution step per delivery clause.

    The book chains them: "Melee Attack Roll: +5 ... Hit: 8 (1d10 + 3) Slashing
    damage. If the target is a creature ... Constitution Saving Throw: DC 12.
    Failure: ..." is an attack and then, on a hit, a save. Each is its own step
    with its own numbers and its own outcome branches.
    """
    marks = [(m.start(), m.group(1)) for m in DELIVERY_RE.finditer(text)]
    if not marks:
        return [{'precondition': 'ALWAYS', 'delivery': 'AUTOMATIC', 'attackKind': None,
                 'attackBonus': None, 'reachFeet': None, 'rangeFeet': None, 'rangeLongFeet': None,
                 'saveAbility': None, 'saveDc': None, 'targetFilter': None,
                 'effects': branch_effects(text)}]
    steps = []
    for i, (pos, marker) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        seg = text[pos:end]
        gate = text[marks[i - 1][0]:pos] if i else ''
        step = {'precondition': 'ALWAYS', 'delivery': 'AUTOMATIC', 'attackKind': None,
                'attackBonus': None, 'reachFeet': None, 'rangeFeet': None, 'rangeLongFeet': None,
                'saveAbility': None, 'saveDc': None, 'targetFilter': None, 'effects': []}
        if i:
            # A later step only happens because the one before it landed.
            step['precondition'] = ('ON_PREVIOUS_HIT' if 'Attack Roll:' in marks[i - 1][1]
                                    else 'ON_PREVIOUS_FAILURE')
            cond = re.search(r'(If the target[^.]*?),? it (?:is subjected to|must make)', gate)
            if cond:
                step['targetFilter'] = cond.group(1).strip()
        a = ATTACK.match(seg)
        if a:
            step['delivery'] = 'ATTACK_ROLL'
            step['attackKind'] = {'Melee': 'MELEE', 'Ranged': 'RANGED',
                                  'Melee or Ranged': 'MELEE_OR_RANGED'}[a.group('kind')]
            step['attackBonus'] = int(a.group('bonus'))
            reach = re.search(r'reach (\d+) ?ft', a.group('reach'))
            rng = re.search(r'range (\d+)/(\d+) ?ft', a.group('reach'))
            if reach:
                step['reachFeet'] = int(reach.group(1))
            if rng:
                step['rangeFeet'], step['rangeLongFeet'] = int(rng.group(1)), int(rng.group(2))
        else:
            sv = SAVE.match(seg)
            if sv:
                step['delivery'] = 'SAVING_THROW'
                step['saveAbility'] = sv.group('ability').upper()
                step['saveDc'] = int(sv.group('dc'))
                rng = re.search(r'within (\d+) feet', sv.group('targets'))
                if rng:
                    step['rangeFeet'] = int(rng.group(1))
        step['effects'] = branch_effects(seg)
        steps.append(step)
    return steps


def parse_feature(name, text, activation, ordinal):
    base, reset, uses, rmin, rmax = parse_uses(name)
    trigger = None
    body = text
    t = re.search(r'Trigger:\s*(.*?)(?:\s*Response:\s*(.*))?$', text, re.S)
    if t and t.group(2):
        trigger, body = t.group(1).strip(), t.group(2).strip()
    return {'name': base, 'description': text.strip(), 'ordinal': ordinal,
            'activation': activation, 'legendaryCost': None, 'usesReset': reset, 'usesMax': uses,
            'rechargeMin': rmin, 'rechargeMax': rmax, 'triggerText': trigger,
            'steps': parse_steps(body)}


def parse_block(name, body):
    b = {'name': name, 'size': None, 'creatureType': None, 'creatureSubtype': None,
         'alignment': None, 'armorClass': None, 'initiativeBonus': None, 'hpAverage': None,
         'hpDiceCount': None, 'hpDiceFaces': None, 'hpDiceBonus': None, 'speeds': {},
         'canHover': False, 'scores': {}, 'saves': {}, 'skills': {}, 'senses': {},
         'passivePerception': None, 'damageResponses': [], 'conditionImmunities': [],
         'gear': [], 'languages': None, 'telepathyFeet': None, 'challengeRating': None,
         'experiencePoints': None, 'proficiencyBonus': None, 'legendaryActionUses': None,
         'alternateSize': None, 'features': [],
         'spellSaveDc': None, 'spellAttackBonus': None, 'spellcastingAbility': None,
         'knownSpells': []}

    m = HEADER.match(body[0])
    # "Medium or Small" — the book's first size is the default one.
    b['size'] = m.group(1).split(' or ')[0].upper()
    b['alternateSize'] = (m.group(1).split(' or ')[1].upper()
                          if ' or ' in m.group(1) else None)
    b['creatureType'] = m.group(3).upper()
    b['creatureSubtype'] = m.group(4)
    if m.group(2):
        # "Medium Swarm of Tiny Beasts" — the type is printed in the plural
        # because the block is a swarm. The creature type is still Beast; that
        # it is a swarm, and of what size, goes in the subtype.
        b['creatureType'] = re.sub(r'S$', '', m.group(3).upper())
        b['creatureSubtype'] = (m.group(2) + m.group(3)).strip()
    b['alignment'] = m.group(5).strip().upper().replace(' ', '_').rstrip('.')
    if b['alignment'] not in (
            'LAWFUL_GOOD', 'NEUTRAL_GOOD', 'CHAOTIC_GOOD', 'LAWFUL_NEUTRAL', 'NEUTRAL',
            'CHAOTIC_NEUTRAL', 'LAWFUL_EVIL', 'NEUTRAL_EVIL', 'CHAOTIC_EVIL', 'UNALIGNED'):
        b['alignment'] = 'ANY' if 'ANY' in b['alignment'] else None

    # Header entries wrap: "Immunities Poison, Thunder; Exhaustion, Grappled," can
    # run over three lines. Join a continuation onto the label it belongs to
    # before parsing, or everything past the first line is silently dropped.
    LABELS = ('AC ', 'HP ', 'Speed ', 'Skills ', 'Resistances ', 'Immunities ',
              'Vulnerabilities ', 'Gear ', 'Senses ', 'Languages ', 'CR ', 'Str ', 'Int ',
              'MOD ')
    joined, buf = [], None
    for line in body[1:]:
        if line in SECTIONS or (buf is not None and buf[0] in SECTIONS):
            break
        if any(line.startswith(p) for p in LABELS):
            if buf:
                joined.append(buf)
            buf = line
        elif buf and line:
            buf += ' ' + line
        elif not line:
            if buf:
                joined.append(buf)
            buf = None
    if buf:
        joined.append(buf)
    header_end = 1
    for k, line in enumerate(body[1:], start=1):
        if line in SECTIONS:
            header_end = k
            break
    else:
        header_end = len(body)

    section, feature_lines, sections = None, [], []
    for line in joined + body[header_end:]:
        if line in SECTIONS:
            if section:
                sections.append((section, feature_lines))
            section, feature_lines = line, []
            continue
        if section:
            feature_lines.append(line)
            continue
        # header block
        if line.startswith('AC '):
            ac = re.match(r'AC (\d+)', line)
            if ac:
                b['armorClass'] = int(ac.group(1))
            init = re.search(r'Initiative ([+-]\d+)', line)
            if init:
                b['initiativeBonus'] = int(init.group(1))
        elif line.startswith('HP '):
            hp = re.match(r'HP ' + DICE, line)
            if hp:
                b['hpAverage'] = int(hp.group(1))
                b['hpDiceCount'], b['hpDiceFaces'], b['hpDiceBonus'] = split_dice(hp.group(2))
            else:
                flat = re.match(r'HP (\d+)', line)
                if flat:
                    b['hpAverage'] = int(flat.group(1))
        elif line.startswith('Speed '):
            b['speeds'], b['canHover'] = parse_speeds(line)
        elif re.match(r'^(Str|Int) ', line):
            for ab, score, _mod, save in re.findall(
                    r'(%s) ?(\d+) ([+-]\d+) ([+-]?\d+)' % '|'.join(ABILITIES), line):
                b['scores'][ABILITY_NAMES[ab]] = int(score)
                if save.lstrip('+') != _mod.lstrip('+'):
                    b['saves'][ABILITY_NAMES[ab]] = int(save)
        elif line.startswith('Skills '):
            for label, key in SKILLS.items():
                s = re.search(r'\b%s ([+-]\d+)' % label, line)
                if s:
                    b['skills'][key] = int(s.group(1))
        elif line.startswith('Resistances '):
            dmg, _ = parse_damage_list(line[len('Resistances '):])
            b['damageResponses'] += [{'damageType': d.upper(), 'response': 'RESISTANCE'} for d in dmg]
        elif line.startswith('Immunities '):
            dmg, conds = parse_damage_list(line[len('Immunities '):])
            b['damageResponses'] += [{'damageType': d.upper(), 'response': 'IMMUNITY'} for d in dmg]
            b['conditionImmunities'] += conds
        elif line.startswith('Vulnerabilities '):
            dmg, _ = parse_damage_list(line[len('Vulnerabilities '):])
            b['damageResponses'] += [{'damageType': d.upper(), 'response': 'VULNERABILITY'} for d in dmg]
        elif line.startswith('Gear '):
            for part in re.split(r',', line[len('Gear '):]):
                item = re.sub(r'\(.*?\)', '', part).strip()
                if item:
                    qty = re.search(r'\((\d+)\)', part)
                    b['gear'].append({'name': item, 'quantity': int(qty.group(1)) if qty else 1})
        elif line.startswith('Senses '):
            for s in SENSES:
                m2 = re.search(r'%s (\d+) ?ft' % s, line)
                if m2:
                    b['senses'][s.upper()] = int(m2.group(1))
            pp = re.search(r'Passive Perception (\d+)', line)
            if pp:
                b['passivePerception'] = int(pp.group(1))
        elif line.startswith('Languages '):
            b['languages'] = line[len('Languages '):].strip() or None
            tel = re.search(r'telepathy (\d+) ?ft', line, re.I)
            if tel:
                b['telepathyFeet'] = int(tel.group(1))
        elif line.startswith('CR '):
            cr = re.match(r'CR ([\d/]+)', line)
            if cr:
                v = cr.group(1)
                b['challengeRating'] = (float(v.split('/')[0]) / float(v.split('/')[1])
                                        if '/' in v else float(v))
            xp = re.search(r'XP ([\d,]+)', line)
            if xp:
                b['experiencePoints'] = int(xp.group(1).replace(',', ''))
            pb = re.search(r'PB \+(\d+)', line)
            if pb:
                b['proficiencyBonus'] = int(pb.group(1))
    if section:
        sections.append((section, feature_lines))

    ordinal = 0
    for section_name, chunk in sections:
        activation = SECTIONS[section_name]
        if section_name == 'Legendary Actions':
            joined = ' '.join(chunk)
            uses = re.search(r'Legendary Action Uses: (\d+)', joined)
            if uses:
                b['legendaryActionUses'] = int(uses.group(1))
        starts = feature_starts(chunk)
        for k, (idx, fname, rest) in enumerate(starts):
            end = starts[k + 1][0] if k + 1 < len(starts) else len(chunk)
            text = ' '.join([rest] + chunk[idx + 1:end])
            text = re.sub(r'-\s+(?=[a-z])', '', text)
            text = re.sub(r'\s+', ' ', text).strip()
            if not text:
                continue
            b['features'].append(parse_feature(fname, text, activation, ordinal))
            ordinal += 1
    return b


# region Multiattack
#
# A Multiattack is a sentence that refers to the creature's other actions, so
# it is resolved after the whole stat block is parsed and its feature names are
# known. Half the book's Multiattacks are a choice, a replacement or an
# alternative rather than a fixed list, and flattening those loses the count:
# "three attacks, using Shortsword or Light Crossbow in any combination" is not
# three of each.

WORD_NUMBERS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
                'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10}
# Spelled out rather than \w+: "The dragon makes three Rend attacks" otherwise
# matches with "The" as the count, swallowing the sentence, and finditer never
# retries the real match inside the span it just consumed.
NUM = '(?:%s)' % '|'.join(WORD_NUMBERS)
NAME = r"[\w'’-][\w'’ -]*?"


def count_of(word):
    return WORD_NUMBERS.get((word or '').lower())


def names_in(text, names):
    """Feature names appearing in a fragment, in the order the book lists them.

    Longest first, so "Infernal Glaive" doesn't also match as "Glaive"; a matched
    span is blanked so a shorter name can't be found inside a longer one.
    """
    found, remaining = [], text
    for name in sorted(names, key=len, reverse=True):
        for m in re.finditer(re.escape(name), remaining):
            found.append((m.start(), name))
        remaining = re.sub(re.escape(name), lambda m: '\0' * len(m.group()), remaining)
    return [n for _, n in sorted(found)]


def parse_multiattack(desc, names, self_name='Multiattack'):
    """(components, unparsed) — the structured plan, and any clause left over."""
    others = [n for n in names if n != self_name]
    components, leftover, counter = [], [], [0]

    def add(name, count, mode, at, optional=False, choice=None):
        components.append({'feature': name, 'count': count, 'mode': mode,
                           'optional': optional, 'choiceGroup': choice, '_at': at})

    def group():
        counter[0] += 1
        return counter[0] - 1

    def plan(fragment, mode, base):
        """One attack plan: fixed attacks, or a free combination among a set."""
        used = False
        # "makes three attacks, using ..." and the Tarrasque's "one Bite attack
        # and three other attacks, using ..." — the clause doesn't need "makes".
        m = re.search(r'\b(%s) (?:other )?attacks?, using (.+?) in any combination' % NUM,
                      fragment)
        if m:
            picks = names_in(m.group(2), others)
            if picks:
                g = group()
                for p in picks:
                    add(p, count_of(m.group(1)), 'CHOICE', base + m.start(), choice=g)
                used = True
            # Blanked rather than cut, so the offsets of what follows still line
            # up with the sentence — components read in the book's order.
            fragment = fragment[:m.start()] + ' ' * (m.end() - m.start()) + fragment[m.end():]
        # "makes two Rend attacks", "one Claw attack and one Tail attack",
        # "two Javelin or Morningstar attacks"
        for m in re.finditer(r'\b(%s) (%s(?: or %s)?) attacks?\b' % (NUM, NAME, NAME), fragment):
            n, picks = count_of(m.group(1)), names_in(m.group(2), others)
            if not n or not picks:
                continue
            if len(picks) > 1:
                g = group()
                for p in picks:
                    add(p, n, 'CHOICE' if mode == 'FIXED' else mode, base + m.start(), choice=g)
            else:
                add(picks[0], n, mode, base + m.start(),
                    choice=group() if mode == 'ALTERNATIVE' else None)
            used = True
        return used

    def uses(fragment, base):
        """The "and uses X" tail: a non-attack action folded into the same turn."""
        m = re.search(r'\b(?:and (?:it )?)?(?:uses|can use) (?:either )?(.+?)'
                      r'(?: if available)?\.?$', fragment)
        if not m:
            return False
        picks = names_in(m.group(1), others)
        if not picks:
            return False
        optional = bool(re.search(r'can use|if available', fragment))
        if len(picks) > 1:
            g = group()
            for p in picks:
                add(p, 1, 'CHOICE', base + m.start(), optional=optional, choice=g)
        else:
            add(picks[0], 1, 'FIXED', base + m.start(), optional=optional)
        return True

    at = 0
    for sentence in re.split(r'(?<=\.)\s+', desc.strip()):
        at += len(sentence) + 1
        if not sentence.strip():
            continue
        # "It can replace one attack with a use of Spellcasting"
        m = re.match(r'It can replace (?:the |(%s) |any )?(?:%s )?attacks? with '
                     r'(?:a use of |an? )?(.+?)\.?$' % (NUM, NAME), sentence)
        if m:
            picks = names_in(m.group(2), others)
            if picks:
                g = group() if len(picks) > 1 else None
                for p in picks:
                    add(p, count_of(m.group(1)) or 1, 'REPLACEMENT', at, optional=True, choice=g)
                continue
            leftover.append(sentence)
            continue
        # ", or it makes two Hurl Flame attacks" — a whole alternative plan.
        handled, offset = False, at
        for i, part in enumerate(re.split(r',? or it (?=makes\b)', sentence)):
            if plan(part, 'FIXED' if i == 0 else 'ALTERNATIVE', offset):
                handled = True
            if uses(part, offset):
                handled = True
            offset += len(part)
        if not handled:
            leftover.append(sentence)
    # The book's reading order, which is what `ordinal` renders.
    components.sort(key=lambda c: c.pop('_at'))
    return components, leftover


def link_multiattacks(block):
    """Attach components to any feature that refers to the block's own actions."""
    names = [f['name'] for f in block['features']]
    for f in block['features']:
        f['components'] = []
        if not f['name'].lower().startswith('multiattack'):
            continue
        components, unparsed = parse_multiattack(f['description'], names, f['name'])
        f['components'] = components
        for clause in unparsed:
            print('unstructured multiattack: %s: %s' % (block['name'], clause),
                  file=sys.stderr)

# endregion


# region spellcasting
#
# A monster's spellcasting is not a spell list plus slots — it is "At Will:
# Detect Magic" and "1/Day Each: Finger of Death", printed inside the
# Spellcasting trait's own sentence. The bands and the save DC are structured;
# a feature that casts one named spell inline ("the devil casts Misty Step") is
# left alone, because that feature already *is* the spell's row and importing it
# here would have the simulator find the same casting twice.

# Each band runs to the next band's marker, or to the end of the sentence. A
# greedy match swallows "1/Day Each:" into the At Will list, and the spell after
# it becomes part of the spell before it.
SPELL_BAND = re.compile(
    r'(?P<band>At Will|(?P<per_day>\d+)/Day(?: Each)?):\s*'
    r'(?P<spells>.+?)(?=\s*(?:At Will|\d+/Day(?: Each)?):|\.\s|$)')
# "using Intelligence as the spellcasting ability (spell save DC 20, +12 to hit"
CASTING = re.compile(
    r'using (?:the spell\'s own ability|(?P<ability>\w+)) as the spellcasting ability'
    r'[^(]*\(spell save DC (?P<dc>\d+)(?:, (?P<bonus>[+-]\d+) to hit)?')
# The hags cast from a plain list and recharge it on a Long Rest.
COVEN = re.compile(r'spell save DC \d+\):\s*(?P<spells>[^.]+)\.')


SPELL_NAMES = sorted(
    json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                'spell-names.json'))),
    key=len, reverse=True)


def resolve_spell(entry):
    """The spell an entry names, and the level it is cast at.

    Matched against the catalog rather than trimmed by a rule: the band can run
    into the sentence after it ("Plane Shift Red Dragons") or into the next
    feature entirely ("Zone of Truth Weakening Breath"), and the longest name
    that is actually a spell is the only reliable way to say where it stopped.
    """
    m = re.match(r"^(?:or\s+)?(?P<name>.+?)(?:\s*\(level (?P<level>\d+) version\))?$", entry.strip())
    if not m:
        return None, None
    text = m.group('name').strip()
    level = int(m.group('level')) if m.group('level') else None
    for name in SPELL_NAMES:
        if text == name or text.startswith(name + ' '):
            return name, level
    return None, None


def parse_spellcasting(block):
    """Fill the stat block's casting numbers, and its list of known spells."""
    known = []
    for f in block['features']:
        text = f['description'] or ''
        m = CASTING.search(text)
        if not m:
            continue
        if block['spellSaveDc'] is None:
            block['spellSaveDc'] = int(m.group('dc'))
            block['spellAttackBonus'] = int(m.group('bonus')) if m.group('bonus') else None
            block['spellcastingAbility'] = ABILITY_NAMES.get(
                (m.group('ability') or '')[:3], None) or (
                    m.group('ability').upper() if m.group('ability') else None)

        bands = list(SPELL_BAND.finditer(text))
        if bands:
            for band in bands:
                per_day = band.group('per_day')
                # Commas inside a parenthetical belong to it, not to the list:
                # "Shapechange (Beast or Humanoid form only, no Temporary Hit
                # Points gained from the spell, ...)" is one entry.
                for entry in re.split(r',\s*(?![^()]*\))', band.group('spells')):
                    name, level = resolve_spell(entry)
                    if not name:
                        continue
                    known.append({
                        'name': name, 'level': level,
                        'usesReset': 'PER_DAY' if per_day else 'AT_WILL',
                        'usesMax': int(per_day) if per_day else None,
                    })
            continue
        coven = COVEN.search(text)
        if coven and ' or ' in coven.group('spells'):
            # No bands: the hags' coven list, one casting per Long Rest.
            for entry in re.split(r',\s*(?![^()]*\))', coven.group('spells')):
                name, level = resolve_spell(entry)
                if name:
                    known.append({'name': name, 'level': level,
                                  'usesReset': 'LONG_REST', 'usesMax': 1})
    # One creature can print the same spell in two traits; the first wins.
    seen, out = set(), []
    for k in known:
        if k['name'] not in seen:
            seen.add(k['name'])
            out.append(k)
    block['knownSpells'] = out

# endregion


def main():
    lines = load_lines()
    lines = [l for l in lines if not re.match(r'^\d{1,3} System Reference Document', l)]
    starts = [i for i, l in enumerate(lines)
              if HEADER.match(l) and any(lines[k].startswith('AC ')
                                         for k in range(i + 1, min(i + 4, len(lines))))]
    blocks = []
    for n, i in enumerate(starts):
        end = starts[n + 1] - 1 if n + 1 < len(starts) else len(lines)
        # The next creature's name is printed twice — once as the running head
        # of its column and once as its entry — so excluding one line still
        # leaves the other stuck on the end of this creature's last feature.
        if n + 1 < len(starts):
            following = lines[starts[n + 1] - 1].strip()
            while end > i and lines[end - 1].strip() in ('', following):
                end -= 1
        block = parse_block(lines[i - 1].strip(), lines[i:end])
        link_multiattacks(block)
        parse_spellcasting(block)
        blocks.append(block)
    json.dump(blocks, open(OUT, 'w'), indent=1)

    feats = sum(len(b['features']) for b in blocks)
    steps = sum(len(f['steps']) for b in blocks for f in b['features'])
    effs = sum(len(st['effects']) for b in blocks for f in b['features'] for st in f['steps'])
    comps = sum(len(f['components']) for b in blocks for f in b['features'])
    spells = sum(len(b['knownSpells']) for b in blocks)
    print(f'stat blocks {len(blocks)}  features {feats}  steps {steps}  effects {effs}  '
          f'components {comps}  known spells {spells}', file=sys.stderr)
    return blocks


if __name__ == '__main__':
    main()
