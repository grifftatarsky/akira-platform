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
    """Damage, rolled or flat.

    The weakest creatures in the book deal "Hit: 1 Piercing damage" with no dice
    at all. DICE requires the "N (XdY)" form, so fifteen attacks — every one on a
    Tiny familiar or a swarm's component — parsed with a delivery and a to-hit
    bonus but nothing to apply on a hit.
    """
    out = []
    spans = []
    for m in re.finditer(DICE + r' (\w+) damage', segment):
        if m.group(3) not in DAMAGE_TYPES:
            continue
        count, faces, bonus = split_dice(m.group(2))
        spans.append(m.span())
        out.append({'outcome': outcome, 'kind': 'DAMAGE', 'diceCount': count, 'diceFaces': faces,
                    'diceBonus': bonus, 'diceAverage': int(m.group(1)),
                    'damageType': m.group(3).upper(), 'halfDamage': False,
                    'conditionName': None, 'escapeDc': None, 'notes': None,
                    'movementType': None, 'movementFeet': None,
                    'durationAmount': None, 'durationUnit': None})
    for m in re.finditer(r'\b(\d+) (\w+) damage', segment):
        if m.group(2) not in DAMAGE_TYPES:
            continue
        if any(a <= m.start() < b for a, b in spans):
            continue  # the dice form above already claimed this one
        flat = int(m.group(1))
        out.append({'outcome': outcome, 'kind': 'DAMAGE', 'diceCount': None, 'diceFaces': None,
                    'diceBonus': flat, 'diceAverage': flat,
                    'damageType': m.group(2).upper(), 'halfDamage': False,
                    'conditionName': None, 'escapeDc': None, 'notes': None,
                    'movementType': None, 'movementFeet': None,
                    'durationAmount': None, 'durationUnit': None})
    return out


def healing_effects(segment, outcome):
    """Regained Hit Points, rolled or flat.

    Both forms appear: "regains 5 (1d10) Hit Points" and the troll's plain
    "regains 15 Hit Points". DiceRoll already models the flat case — a null
    count with the amount in bonus/average — so both land in one effect kind
    rather than one being dropped for having no dice.
    """
    out = []
    def row(count, faces, bonus, average):
        return {'outcome': outcome, 'kind': 'HEALING', 'diceCount': count, 'diceFaces': faces,
                'diceBonus': bonus, 'diceAverage': average, 'damageType': None,
                'halfDamage': False, 'conditionName': None, 'escapeDc': None, 'notes': None,
                'movementType': None, 'movementFeet': None,
                'durationAmount': None, 'durationUnit': None}

    spans = []
    for m in re.finditer(DICE + r' Hit Points', segment):
        count, faces, bonus = split_dice(m.group(2))
        out.append(row(count, faces, bonus, int(m.group(1))))
        spans.append(m.span())
    for m in re.finditer(r'regains (\d+) Hit Points', segment):
        if any(a <= m.start() < b for a, b in spans):
            continue  # already taken by the dice form above
        flat = int(m.group(1))
        out.append(row(None, None, flat, flat))
    return out


def movement_effects(segment, outcome):
    """Forced movement — "pushed up to 30 feet straight away from the dragon".

    Distinct from a creature spending its own Speed: the target does not choose
    it and it does not cost movement, so the engine has to apply it rather than
    offer it.
    """
    out = []
    for m in re.finditer(
            r'(pushed|pulled|moved|knocked back)(?: up to)? (\d+) feet', segment, re.I):
        out.append({'outcome': outcome, 'kind': 'MOVEMENT', 'diceCount': None, 'diceFaces': None,
                    'diceBonus': None, 'diceAverage': None, 'damageType': None,
                    'halfDamage': False, 'conditionName': None, 'escapeDc': None,
                    # movementType is the five *speeds* (WALK/FLY/…), which is a
                    # different question from "who is moving this creature". The
                    # verb goes in notes until forced movement gets a direction
                    # enum of its own; guessing WALK here would say the target
                    # spent its own movement, which is exactly backwards.
                    'notes': m.group(1).lower(), 'movementType': None,
                    'movementFeet': int(m.group(2)),
                    'durationAmount': None, 'durationUnit': None})
    return out


# "until the end of its next turn" and "until the start of its next turn" both
# come out as one round. The model carries an amount and a unit but no anchor,
# so the start/end distinction is lost here — it matters for exactly when a
# condition drops off, and wants a durationAnchor column before the engine
# leans on it. One round is right to within half a turn either way.
DURATIONS = [
    (r'until the (?:end|start) of (?:its|the target\'s|their) next turn', 1, 'ROUND'),
    (r'for (\d+) minutes?', None, 'MINUTE'),
    (r'for (\d+) hours?', None, 'HOUR'),
    (r'for 1 minute', 1, 'MINUTE'),
]


def duration_of(segment):
    """How long a condition applied in this segment lasts, if the book says."""
    for pattern, fixed, unit in DURATIONS:
        m = re.search(pattern, segment, re.I)
        if m:
            return (fixed if fixed is not None else int(m.group(1))), unit
    return None, None


def condition_effects(segment, outcome):
    out = []
    amount, unit = duration_of(segment)
    esc = re.search(r'escape DC (\d+)', segment)
    joined = '|'.join(CONDITIONS)
    for m in re.finditer(r'has the (%s) and (%s) conditions' % (joined, joined), segment):
        for name in (m.group(1), m.group(2)):
            out.append({'outcome': outcome, 'kind': 'APPLY_CONDITION', 'diceCount': None,
                        'diceFaces': None, 'diceBonus': None, 'diceAverage': None,
                        'damageType': None, 'halfDamage': False, 'conditionName': name,
                        'escapeDc': int(esc.group(1)) if esc else None, 'notes': None,
                        'movementType': None, 'movementFeet': None,
                        'durationAmount': amount, 'durationUnit': unit})
    for m in re.finditer(r'has the (%s) condition(?! ?s)' % joined, segment):
        out.append({'outcome': outcome, 'kind': 'APPLY_CONDITION', 'diceCount': None,
                    'diceFaces': None, 'diceBonus': None, 'diceAverage': None, 'damageType': None,
                    'halfDamage': False, 'conditionName': m.group(1),
                    'escapeDc': int(esc.group(1)) if esc else None, 'notes': None,
                    'movementType': None, 'movementFeet': None,
                    'durationAmount': amount, 'durationUnit': unit})
    return out


# region riders
#
# The book's third mechanical voice. "Advantage on attack rolls", "its Speed is
# halved", "adds 2 to its AC", "subtracts 3 (1d6) from its damage rolls" — none
# of them damage, none of them conditions, and between them the commonest thing
# a monster does. 303 passive traits had no mechanical representation at all
# before this: a Pack Tactics creature attacked as though it stood alone.

RIDER_TARGETS = [
    (r'attack rolls?', 'ATTACK_ROLL'),
    (r'saving throws?', 'SAVING_THROW'),
    (r'ability checks?', 'ABILITY_CHECK'),
    (r'D20 Tests?', 'D20_TEST'),
    (r'Initiative', 'INITIATIVE'),
    (r'damage rolls?', 'DAMAGE_ROLL'),
]
# Spelled out, for rider text like "Strength-based D20 Tests". Deliberately not
# ABILITIES or ABILITY_NAMES: both are taken above by the stat-block header
# parser, and shadowing either makes the score line stop matching and silently
# empties every creature's saving throws. Both collisions happened; only a test
# asserting one dragon's Dexterity save caught them.
RIDER_ABILITY_WORDS = ('Strength', 'Dexterity', 'Constitution', 'Intelligence',
                       'Wisdom', 'Charisma')


def _rider(target, mode, **kw):
    r = {'target': target, 'mode': mode, 'amount': None, 'diceCount': None, 'diceFaces': None,
         'diceBonus': None, 'diceAverage': None, 'ability': None, 'damageType': None,
         'gate': None, 'durationAmount': None, 'durationUnit': None,
         'removedBy': None, 'destroyedAt': None}
    r.update(kw)
    return r


def parse_riders(segment):
    """Standing modifiers stated in this clause."""
    out = []
    amount, unit = duration_of(segment)

    # "has Advantage on attack rolls", "Disadvantage on Strength-based D20 Tests"
    for m in re.finditer(r'(?:has|have|gains?)\s+(Advantage|Disadvantage) on ([^.;,]{0,60})', segment):
        mode, what = m.group(1).upper(), m.group(2)
        abil = next((a for a in RIDER_ABILITY_WORDS if re.search(r'%s-based' % a, what)), None)
        for pat, target in RIDER_TARGETS:
            if re.search(pat, what, re.I):
                out.append(_rider(target, mode, ability=abil.upper() if abil else None,
                                  durationAmount=amount, durationUnit=unit))
                break

    # "its Speed is halved"
    if re.search(r'Speed is halved', segment, re.I):
        out.append(_rider('SPEED', 'HALVE', durationAmount=amount, durationUnit=unit))

    # "The target can't take Reactions"
    if re.search(r"can'?t take Reactions", segment, re.I):
        out.append(_rider('REACTION', 'DENY', durationAmount=amount, durationUnit=unit))

    # "adds 2 to its AC", "gains a +5 bonus to AC"
    for m in re.finditer(r'(?:adds (\d+) to its AC|gains a \+(\d+) bonus to AC)', segment):
        out.append(_rider('ARMOR_CLASS', 'BONUS', amount=int(m.group(1) or m.group(2)),
                          durationAmount=amount, durationUnit=unit))

    # "the sphinx adds 2 to the roll" — a bonus to whatever was rolled.
    for m in re.finditer(r'adds (\d+) to the roll', segment):
        out.append(_rider('D20_TEST', 'BONUS', amount=int(m.group(1))))

    # "subtracts 3 (1d6) from its damage rolls"
    for m in re.finditer(r'subtracts ' + DICE + r' from its damage rolls', segment):
        count, faces, bonus = split_dice(m.group(2))
        out.append(_rider('DAMAGE_ROLL', 'BONUS', amount=-int(m.group(1)), diceCount=count,
                          diceFaces=faces, diceBonus=bonus, diceAverage=int(m.group(1)),
                          durationAmount=amount, durationUnit=unit))

    # The rust monster's corrosion, which is the only item-durability rule in the
    # book: a cumulative penalty with a stated destruction point and a stated
    # cure, so both belong on the rider rather than in a handler somewhere.
    if re.search(r'cumulative -1 penalty to (?:the )?damage rolls?|takes a cumulative -1 penalty',
                 segment) and not re.search(r'penalty to the AC it offers', segment):
        cure = re.search(r'removed by casting the (\w+) spell|(Mending) spell', segment)
        out.append(_rider('ITEM_ATTACK_ROLL', 'BONUS', amount=-1, destroyedAt=-5,
                          removedBy=cure.group(1) if cure else 'Mending'))

    if re.search(r'penalty to the AC it offers', segment):
        cure = re.search(r'removed by casting the (\w+) spell', segment)
        out.append(_rider('ITEM_ARMOR_CLASS', 'BONUS', amount=-1, destroyedAt=10,
                          removedBy=cure.group(1) if cure else None))
        out.append(_rider('ITEM_ATTACK_ROLL', 'BONUS', amount=-1, destroyedAt=-5,
                          removedBy=cure.group(1) if cure else None))

    # Legendary Resistance, on all 32 legendary creatures: the single most
    # consequential passive in the book, and it had no mechanical form at all.
    # The feature's own 3/Day already parses; this is what it spends a use on.
    if re.search(r'automatically succeeds on saving throws', segment, re.I):
        out.append(_rider('SAVING_THROW', 'AUTO_SUCCEED',
                          gate='against spells and other magical effects'))

    if re.search(r'fails a saving throw, it can choose to succeed instead', segment, re.I):
        out.append(_rider('SAVING_THROW', 'AUTO_SUCCEED',
                          gate='on a failed save, before the outcome is applied'))

    # "its Hit Point maximum decreases by an amount equal to the damage taken"
    if re.search(r'Hit Point maximum decreases', segment):
        out.append(_rider('HIT_POINT_MAXIMUM', 'BONUS', gate='by the damage taken'))

    return out


def rider_effects(segment, outcome):
    riders = parse_riders(segment)
    if not riders:
        return []
    return [{'outcome': outcome, 'kind': 'APPLY_RIDER', 'diceCount': None, 'diceFaces': None,
             'diceBonus': None, 'diceAverage': None, 'damageType': None, 'halfDamage': False,
             'conditionName': None, 'escapeDc': None, 'notes': None, 'movementType': None,
             'movementFeet': None, 'durationAmount': None, 'durationUnit': None,
             'riders': riders}]

# endregion


def _plain(outcome, kind, **kw):
    e = {'outcome': outcome, 'kind': kind, 'diceCount': None, 'diceFaces': None,
         'diceBonus': None, 'diceAverage': None, 'damageType': None, 'halfDamage': False,
         'conditionName': None, 'escapeDc': None, 'notes': None, 'movementType': None,
         'movementFeet': None, 'durationAmount': None, 'durationUnit': None, 'riders': []}
    e.update(kw)
    return e


def self_movement_effects(segment, outcome):
    """The creature moving itself — teleport, jump, or a burst of its own Speed.

    Distinct from the forced movement in movement_effects(): this one the
    creature chooses and it comes out of nobody's budget but its own.
    """
    out = []
    for m in re.finditer(r'teleports?(?: up to)? (\d+) feet', segment, re.I):
        out.append(_plain(outcome, 'MOVEMENT', movementFeet=int(m.group(1)), notes='teleport'))
    for m in re.finditer(r'jumps? up to (\d+) feet', segment, re.I):
        out.append(_plain(outcome, 'MOVEMENT', movementFeet=int(m.group(1)), notes='jump'))
    for m in re.finditer(r'(?:moves?|flies|swims?) up to (half )?its (Fly |Swim |Climb )?Speed',
                         segment, re.I):
        mode = (m.group(2) or 'WALK').strip().upper() or 'WALK'
        out.append(_plain(outcome, 'MOVEMENT',
                          movementType={'FLY': 'FLY', 'SWIM': 'SWIM', 'CLIMB': 'CLIMB'}.get(mode, 'WALK'),
                          notes='half speed' if m.group(1) else 'full speed'))
    return out


def temp_hp_effects(segment, outcome):
    out = []
    for m in re.finditer(DICE + r' Temporary Hit Points', segment):
        count, faces, bonus = split_dice(m.group(2))
        out.append(_plain(outcome, 'TEMPORARY_HIT_POINTS', diceCount=count, diceFaces=faces,
                          diceBonus=bonus, diceAverage=int(m.group(1))))
    return out


def terrain_effects(segment, outcome):
    """Light and darkness written onto the board, which is real geometry."""
    out = []
    m = re.search(r'(Magical Darkness|Darkness) fills a (\d+)-foot Emanation', segment)
    if m:
        out.append(_plain(outcome, 'AREA_TERRAIN', movementFeet=int(m.group(2)),
                          notes='darkness'))
    m = re.search(r'sheds Bright Light in a (\d+)-foot radius', segment)
    if m:
        out.append(_plain(outcome, 'AREA_TERRAIN', movementFeet=int(m.group(1)),
                          notes='bright light'))
    return out


def summon_effects(segment, outcome):
    """A new combatant arriving mid-fight."""
    out = []
    m = re.search(r"rises as an? (\w+)[^.]*?\.", segment)
    if m and 'spirit' in segment:
        cap = re.search(r'no more than (%s) (\w+) under its control' % NUM, segment)
        out.append(_plain(outcome, 'SUMMON', notes=m.group(1),
                          summonCount=1,
                          summonMax=count_of(cap.group(1)) if cap else None))
    if re.search(r'splits? into two new', segment):
        out.append(_plain(outcome, 'SUMMON', notes='split', summonCount=1, summonMax=None))
    return out


def information_effects(segment, outcome):
    """Something the DM should weigh that changes no state.

    The sprite's Heart Sight learns a target's emotions and alignment; that is a
    real outcome of a real saving throw and it belongs in the turn's record even
    though no number moves. Dropping it silently is what made these features look
    like unimplementable prose.
    """
    if re.search(r'\bknows the target\'s\b|learns? (?:the target\'s|whether)', segment):
        return [_plain(outcome, 'INFORMATION', notes=segment.strip()[:400])]
    return []


EFFECT_KEYS = {'riders': [], 'summonCount': None, 'summonMax': None, 'movementType': None,
               'movementFeet': None, 'durationAmount': None, 'durationUnit': None,
               'notes': None, 'escapeDc': None, 'conditionName': None}


def all_effects(segment, outcome):
    """Every effect this clause states, normalised to one key set.

    Six builders each grew their own dict over time and the CSV rows go ragged
    the moment one of them forgets a column, so the defaults are applied here
    rather than repeated six times.
    """
    out = _all_effects(segment, outcome)
    for e in out:
        for k, v in EFFECT_KEYS.items():
            e.setdefault(k, v() if callable(v) else ([] if v == [] else v))
    return out


def _all_effects(segment, outcome):
    return (damage_effects(segment, outcome) + condition_effects(segment, outcome)
            + healing_effects(segment, outcome) + movement_effects(segment, outcome)
            + rider_effects(segment, outcome) + self_movement_effects(segment, outcome)
            + temp_hp_effects(segment, outcome) + terrain_effects(segment, outcome)
            + summon_effects(segment, outcome) + information_effects(segment, outcome))


def branch_effects(text):
    """Effects per labelled outcome branch within one resolution step."""
    marks = [(m.start(), m.group(1)) for m in OUTCOME_RE.finditer(text)]
    effects = []
    if not marks:
        return all_effects(text, 'ALWAYS')
    for i, (pos, label) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        seg = text[pos + len(label) + 1:end]
        outcome = dict(OUTCOMES)[label]
        if outcome == 'SAVE_SUCCESS' and re.search(r'Half damage', seg, re.I):
            effects.append({'outcome': outcome, 'kind': 'DAMAGE', 'diceCount': None,
                            'diceFaces': None, 'diceBonus': None, 'diceAverage': None,
                            'damageType': None, 'halfDamage': True, 'conditionName': None,
                            'escapeDc': None, 'notes': None,
                            'movementType': None, 'movementFeet': None,
                            'durationAmount': None, 'durationUnit': None})
            continue
        effects += all_effects(seg, outcome)
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
    # "…can't take this action again until the start of its next turn" is how
    # the 2024 book writes a once-per-round lock. It is stated in the prose only,
    # never in the "(Recharge …)" or "(N/Day)" suffix parse_uses() reads, so it
    # has to be picked up here or half the legendary actions come out AT_WILL.
    if reset == 'AT_WILL' and re.search(
            r"can'?t take this action again until the start of its next turn", text, re.I):
        reset, uses = 'PER_ROUND', 1

    trig_event, trig_damage, trig_threshold = parse_trigger(text, activation)
    caps = parse_capabilities(text, activation)
    aura = parse_aura(text)
    shapes = parse_shapes(text)
    steps = parse_steps(body)
    # A passive with no rider, capability, trigger, aura or effect would be
    # invisible to the engine — the DM would not even see it listed on the
    # creature. The last sixteen are genuinely narrative (a 30 percent chance of
    # knowing Wish, a GM's choice of dragon, a hag coven's shared spell list), so
    # they keep their prose against OTHER: representable, and flagged as work.
    if (activation == 'PASSIVE' and not caps and not trig_event and not aura and not shapes
            and not [e for st in steps for e in st['effects']]):
        caps = [{'capability': 'OTHER', 'amount': None, 'secondAmount': None,
                 'durationUnit': None, 'damageType': None, 'notes': text.strip()[:400]}]
    return {'name': base, 'description': text.strip(), 'ordinal': ordinal,
            'shapes': shapes,
            'capabilities': caps,
            'triggerEvent': trig_event, 'triggerDamageType': trig_damage,
            'triggerThreshold': trig_threshold, 'auraSizeFeet': aura,
            # The 2024 stat blocks give a creature a pool of Legendary Action
            # Uses and every action spends exactly one; the 2014 "Costs 2
            # Actions" wording is gone from the book, so there is no per-action
            # cost left to read. Verified: 0 of 82 say "Costs N".
            'activation': activation, 'legendaryCost': None, 'usesReset': reset, 'usesMax': uses,
            'rechargeMin': rmin, 'rechargeMax': rmax, 'triggerText': trigger,
            'steps': steps}


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


# The twelve standard actions, which the glossary already carries. "The goblin
# takes the Disengage or Hide action" is the same sentence shape as "makes two
# Tentacle attacks" with a different object, so it becomes a component too.
STANDARD_ACTIONS = ('Attack', 'Dash', 'Disengage', 'Dodge', 'Help', 'Hide',
                    'Influence', 'Magic', 'Ready', 'Search', 'Study', 'Utilize')
ACTION_CLAUSE = re.compile(
    r'takes? the ((?:%s)(?:(?:,| or| and)+ (?:%s))*) action' % (
        '|'.join(STANDARD_ACTIONS), '|'.join(STANDARD_ACTIONS)))

# "casts Wall of Ice (level 8 version)", "casts Bless, Dispel Magic, Healing
# Word, or Lesser Restoration", "uses Spellcasting to cast Fear".
CAST_CLAUSE = re.compile(
    r'(?:uses (?:its )?Spellcasting to cast|casts(?: the)?)\s+'
    r'(?P<list>[A-Z][^.;]*?)'
    r'(?=\s*(?:,\s*(?:requiring|using)|\s+spell\b|\.|;|$))')


def action_components(desc, at):
    """Standard actions a feature takes: "takes the Dash or Disengage action"."""
    out = []
    for m in ACTION_CLAUSE.finditer(desc):
        picks = [a for a in STANDARD_ACTIONS if re.search(r'\b%s\b' % a, m.group(1))]
        # Two or more named in one clause are alternatives, not a sequence.
        mode = 'CHOICE' if len(picks) > 1 else 'FIXED'
        for p in picks:
            out.append({'action': p, 'feature': None, 'spell': None, 'spellLevel': None,
                        'count': 1, 'mode': mode, 'optional': False,
                        'choiceGroup': 0 if len(picks) > 1 else None, '_at': at + m.start()})
    return out


def spell_components(desc, at):
    """Named spells a feature casts, resolved against the seeded catalog."""
    out = []
    for m in CAST_CLAUSE.finditer(desc):
        # "Bless, Dispel Magic, Healing Word, or Lesser Restoration" is a choice
        # among four; a single name is just that one.
        picks = []
        for part in re.split(r',\s*(?:or\s+)?|\s+or\s+', m.group('list')):
            name, level = resolve_spell(part)
            if name:
                picks.append((name, level))
        mode = 'CHOICE' if len(picks) > 1 else 'FIXED'
        for name, level in picks:
            out.append({'spell': name, 'spellLevel': level, 'feature': None, 'action': None,
                        'count': 1, 'mode': mode, 'optional': False,
                        'choiceGroup': 0 if len(picks) > 1 else None, '_at': at + m.start()})
    return out


# region capabilities and triggers
#
# The two things a passive can be that a rider cannot express. A capability is a
# standing permission — Amphibious, Spider Climb, Flyby — and a trigger is when
# an effect fires. Between them and riders, every passive trait in the book has
# a mechanical form; before them, 189 of 335 had none at all.
#
# Ordered, first match wins. The patterns are deliberately anchored on the
# book's own phrasings rather than on keywords: "can breathe air and water" is
# Amphibious wherever it appears, and matching a bare "breathe" would also catch
# Water Breathing, which is the opposite permission.
CAPABILITY_RULES = [
    (r'can breathe air and water, but it must be submerged at least once every (\d+) hours?',
     'MUST_SUBMERGE_PERIODICALLY', 'HOUR'),
    (r'can breathe air and water', 'BREATHE_AIR_AND_WATER', None),
    (r'can breathe only underwater', 'BREATHE_ONLY_WATER', None),
    (r'can hold its breath for (\d+) hours?', 'HOLD_BREATH', 'HOUR'),
    (r'can hold its breath for (\d+) minutes?', 'HOLD_BREATH', 'MINUTE'),
    (r'can climb difficult surfaces', 'CLIMB_WITHOUT_CHECK', None),
    (r'can move across and climb icy surfaces|Difficult Terrain composed of ice or snow',
     'IGNORE_ICE_TERRAIN', None),
    (r'ignores movement restrictions caused by webs', 'IGNORE_WEB_TERRAIN', None),
    (r'move through a space as narrow as 1 inch', 'SQUEEZE_THROUGH_INCH', None),
    (r"can (?:occupy|enter) (?:another creature's|an? (?:creature|enemy)'s) space",
     'OCCUPY_CREATURE_SPACE', None),
    (r'can burrow through (?:solid rock|nonmagical, unworked earth)', 'BURROW_THROUGH_ROCK', None),
    (r'can move through other creatures and objects', 'MOVE_THROUGH_OBJECTS', None),
    (r"doesn'?t provoke an Opportunity Attack", 'NO_OPPORTUNITY_ATTACK_ON_EXIT', None),
    (r'Long Jump is up to (\d+) feet', 'FIXED_JUMP_DISTANCE', 'FEET'),
    (r'jump distance is determined using its Dexterity', 'JUMP_USES_DEXTERITY', None),
    (r"needn'?t spend extra movement to move a creature it is grappling",
     'FREE_GRAPPLE_MOVEMENT', None),
    (r"can'?t shape-shift", 'CANNOT_SHAPE_SHIFT', None),
    (r"can'?t wear or carry anything", 'CANNOT_CARRY', None),
    (r'counts as one size larger for the purpose of determining its carrying capacity',
     'OVERSIZED_CARRYING_CAPACITY', None),
    (r'can take one Reaction on every turn', 'REACTION_EVERY_TURN', None),
    (r'deals double damage to objects and structures', 'DOUBLE_DAMAGE_TO_OBJECTS', None),
    (r'can (?:pinpoint the location of|see) [^.]*?within (\d+) feet|can see (\d+) feet into',
     'DETECT_AT_RANGE', 'FEET'),
    (r'senses magic within (\d+) feet', 'DETECT_AT_RANGE', 'FEET'),
    (r'can communicate telepathically|special telepathy|communicate with it telepathically'
     r'|communicates telepathically with|magically bound to an amulet',
     'BOUND_TELEPATHY', None),
    (r'can communicate with \w+ and \w+ as if they shared a language'
     r'|can mimic (?:animal sounds|simple sounds)|knows if it hears a lie',
     'SPECIAL_COMMUNICATION', None),
    (r"thoughts can'?t be read|No magic can observe", 'MIND_SHIELDED', None),
]


def parse_capabilities(desc, activation):
    """Standing permissions this feature grants.

    Passives only. A standing capability is a trait, and running these patterns
    over actions matches their targeting clauses instead — "one creature the
    dragon can see within 120 feet" is not a sense, it is who the breath hits,
    and reading it as DETECT_AT_RANGE gave 60 false capabilities.
    """
    if activation != 'PASSIVE':
        return []
    out = []
    for pattern, cap, unit in CAPABILITY_RULES:
        m = re.search(pattern, desc, re.I)
        if not m:
            continue
        amount = next((int(g) for g in (m.groups() or ()) if g and g.isdigit()), None)
        second = None
        if cap == 'FIXED_JUMP_DISTANCE':
            hj = re.search(r'High Jump is up to (\d+) feet', desc, re.I)
            second = int(hj.group(1)) if hj else None
        out.append({'capability': cap, 'amount': amount, 'secondAmount': second,
                    'durationUnit': unit if unit != 'FEET' else None,
                    'damageType': None, 'notes': desc.strip()[:400]})
        # One capability per phrasing, but a trait can grant several distinct
        # ones — Water Breathing is "only underwater" *and* an hour of breath.
    return out


# When a passive fires. Ordered; the bloodied variants must precede the plain
# turn ones or "starts its turn Bloodied" reads as an ordinary turn start.
TRIGGER_RULES = [
    (r'starts its turn Bloodied', 'ON_TURN_START_WHILE_BLOODIED'),
    (r'ends any turn Bloodied|ends its turn Bloodied', 'ON_TURN_END_WHILE_BLOODIED'),
    (r'If damage reduces the [\w ]{1,24}? to 0 Hit Points', 'ON_DROP_TO_ZERO_HIT_POINTS'),
    (r'^If (?:the )?[\w ]{1,24}? (?:dies|is destroyed)|If destroyed,|If the [\w ]{1,24}? dies',
     'ON_DEATH'),
    (r'Whenever the [\w ]{1,24}? is subjected to (\w+) damage'
     r'|If the [\w ]{1,24}? takes (\w+) damage', 'ON_DAMAGE_TAKEN'),
    (r'is targeted by a [\w ]+ spell', 'ON_TARGETED_BY_SPELL'),
    (r'starts its turn within (\d+) feet|moves within (\d+) feet', 'ON_CREATURE_NEARBY'),
    (r'starts its turn', 'ON_TURN_START'),
    (r'ends any turn|at the end of each of its turns', 'ON_TURN_END'),
]


def parse_trigger(desc, activation):
    """(event, damageType, threshold) — when this feature fires, if it does."""
    # A Reaction states its own trigger in prose and the DM adjudicates it;
    # pretending to classify that would be worse than saying so.
    if activation == 'REACTION':
        return 'DECLARED_BY_TRIGGER_TEXT', None, None
    for pattern, event in TRIGGER_RULES:
        m = re.search(pattern, desc, re.I | re.M)
        if not m:
            continue
        dmg = None
        if event == 'ON_DAMAGE_TAKEN':
            dmg = next((g.upper() for g in m.groups() if g and g.capitalize() in DAMAGE_TYPES),
                       None)
            if not dmg:
                continue
        thr = re.search(r'took (\d+)\+ (\w+) damage', desc)
        return event, dmg, int(thr.group(1)) if thr else None
    return None, None, None


def parse_aura(desc):
    """Radius of the area a trait projects around its owner, if any.

    Two phrasings: an Emanation, and the light traits' "sheds Bright Light in a
    30foot radius" — where the PDF has swallowed the hyphen, so the pattern
    cannot require one.
    """
    m = re.search(r'(\d+)-foot Emanation originating from', desc)
    if m:
        return int(m.group(1))
    m = re.search(r'sheds Bright Light in a (\d+) ?-?foot radius', desc)
    return int(m.group(1)) if m else None

# endregion


# region shape-shifting
#
# "Other than its size, its game statistics are the same in each form", so a
# form is a size and a set of speeds, not a second stat block. Size is the live
# part: it sets the footprint, and the footprint sets reach and cover.

SIZE_WORDS = ('Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan')
# The book writes a form's speeds two ways: "(Speed 5 ft., Fly Speed 30 ft.)"
# and the terser "(20 ft., Fly 60 ft.)". A bare number is the walking speed.
SPEED_IN_FORM = re.compile(r'\b(?:(Fly|Swim|Climb|Burrow) )?(?:Speed )?(\d+) ?ft')

# Clauses that survive the split but are commentary, not a form.
NOT_A_FORM = re.compile(r'^(using|while|it |and |its |other than|but )', re.I)


def split_forms(text):
    """Split a list of forms on separators that are not inside parentheses.

    "a raven (20 ft., Fly 60 ft.), or a spider" has commas doing two different
    jobs — separating forms and separating that form's own speeds — and a plain
    split turns one raven into two half-forms.
    """
    parts, depth, buf = [], 0, []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth = max(0, depth - 1)
        if depth == 0:
            if ch == ',':
                # ", or" is one separator, not two.
                parts.append(''.join(buf)); buf = []
                i += 1
                continue
            if text.startswith(' or ', i):
                parts.append(''.join(buf)); buf = []
                i += 4
                continue
        buf.append(ch)
        i += 1
    parts.append(''.join(buf))
    return [p for p in parts if p.strip()]


def parse_shapes(desc):
    """The forms a shape-shifting feature offers."""
    if not re.search(r'shape-shifts?|returns to its true form', desc, re.I):
        return []
    out = []
    # Everything between the verb and the sentence end is the list of forms.
    m = re.search(r'shape-shifts?(?: into| to resemble)?\s+(.+?)(?:\.\s|\.$|$)', desc, re.I)
    if not m:
        return []
    for part in split_forms(m.group(1)):
        part = part.strip()
        if not part:
            continue
        if re.search(r'returns? to its true (?:form|\w+ form)', part, re.I):
            out.append({'name': 'true form', 'size': None, 'speeds': {}, 'trueForm': True})
            continue
        size = next((w.upper() for w in SIZE_WORDS if re.search(r'\b%s\b' % w, part)), None)
        speeds = {}
        for sm in SPEED_IN_FORM.finditer(part):
            speeds[(sm.group(1) or 'WALK').upper()] = int(sm.group(2))
        # Strip the parenthetical so the name reads as the book's noun.
        name = re.sub(r'\s*\([^)]*\)', '', part).strip(' .,')
        name = re.sub(r'^(?:an?|the)\s+', '', name, flags=re.I)
        if name and not NOT_A_FORM.match(name):
            out.append({'name': name[:120], 'size': size, 'speeds': speeds, 'trueForm': False})
    return out

# endregion


# region unique behaviour
#
# Two creatures in 330 need rules no general mechanism reaches. Both are keyed
# by name rather than sniffed from prose: a heuristic that fires on the wrong
# creature is worse than a list of two, and the list is the honest size of the
# problem.

UNIQUE = {
    'Hydra': ('HYDRA_HEADS', {'heads': 5, 'startingHeads': 5, 'damageThisTurn': 0,
                              'headsLostSinceLastTurn': 0, 'tookFireDamage': False,
                              'headLossThreshold': 25, 'regrowPerHead': 2,
                              'regrowHitPoints': 20}),
    'Shrieker Fungus': ('SHRIEKER_SHRIEK', {'triggerRadiusFeet': 30, 'audibleFeet': 300,
                                            'durationMinutes': 1, 'shriekingSince': None}),
}


def link_components(block):
    """Attach components to any feature that invokes something else.

    Originally this ran only on features named Multiattack, which left 104
    others reading as unexecutable prose — a dragon's Pounce ("makes one Rend
    attack"), a devil's Ice Wall ("casts Wall of Ice"), a goblin's Nimble Escape
    ("takes the Disengage or Hide action"). They are the same sentence with a
    different object, so they are the same mechanism.
    """
    names = [f['name'] for f in block['features']]
    for f in block['features']:
        components, unparsed = parse_multiattack(f['description'], names, f['name'])
        # A feature must not invoke itself; parse_multiattack already excludes
        # the self name, but a sibling with the same name would slip through.
        for c in components:
            c.setdefault('spell', None)
            c.setdefault('action', None)
            c.setdefault('spellLevel', None)
        # parse_multiattack already popped its own offsets and returned them in
        # book order, so the new kinds append after rather than interleave.
        extra = spell_components(f['description'], 0) + action_components(f['description'], 0)
        extra.sort(key=lambda c: c.pop('_at'))
        f['components'] = components + extra
        if f['name'].lower().startswith('multiattack'):
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
        link_components(block)
        unique = UNIQUE.get(block['name'])
        block['uniqueBehavior'], block['uniqueData'] = unique if unique else (None, None)
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
