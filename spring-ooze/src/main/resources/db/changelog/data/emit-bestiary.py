"""Turn the parsed bestiary into Liquibase load-data CSVs.

Ids are UUIDv5 derived from a stable name, so re-running the parser against the
same PDF produces byte-identical files — the CSVs are reviewable as a diff, and
a correction to the parser shows up as a change to the rows it affects rather
than as 4,000 new ids.
"""
import csv
import json
import os
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
# 029's files are published and immutable, so a later model's data goes in its
# own directory rather than rewriting files 029 checksums. 030 is the step
# model; 032 is the Multiattack components.
STEPS = os.path.join(HERE, '030')
COMPONENTS = os.path.join(HERE, '032')
NS = uuid.UUID('5bd10000-0000-4000-a000-000000000000')  # "SRD" namespace for this import
# Liquibase's loadData DATE parser wants ISO_LOCAL_DATE_TIME; a trailing Z
# makes it give up and inline the value as a bare SQL literal.
STAMP = '2026-09-08T00:00:00'

blocks = json.load(open(os.path.join(HERE, 'bestiary.json')))
# Conditions are seeded by 012 under fixed ids; a stat block's immunities and an
# effect that applies one both join on them by name.
condition_ids = json.load(open(os.path.join(HERE, 'condition-ids.json')))


def uid(*parts):
    return str(uuid.uuid5(NS, 'oozengine:' + ':'.join(str(p) for p in parts)))


NULL = 'NULL'  # matches nullPlaceholder in 029-seed-bestiary.yaml


def n(v):
    """Empty and None become the placeholder loadData reads as SQL NULL."""
    return NULL if v is None or v == '' else v


def write(directory, name, header, rows):
    rows = [[n(c) for c in r] for r in rows]
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, name)
    with open(path, 'w', newline='') as fh:
        w = csv.writer(fh, quoting=csv.QUOTE_MINIMAL, lineterminator='\n')
        w.writerow(header)
        w.writerows(rows)
    print(f'  {name:<44} {len(rows):>5} rows')


monsters, stat_blocks = [], []
speeds, saves, skills, senses, damage, immunities = [], [], [], [], [], []
features, steps, effects, gear, components = [], [], [], [], []

for b in blocks:
    sb = uid('statblock', b['name'])
    mid = uid('monster', b['name'])
    monsters.append([mid, STAMP, STAMP, 0, 'SRD_5_2', b['name'], sb])
    stat_blocks.append([
        sb, STAMP, STAMP, 0, b['size'], b['creatureType'], b['creatureSubtype'] or '',
        b['alignment'] or '', b['armorClass'] if b['armorClass'] is not None else '',
        b['initiativeBonus'] if b['initiativeBonus'] is not None else '',
        b['hpAverage'] if b['hpAverage'] is not None else '',
        b['hpDiceCount'] if b['hpDiceCount'] is not None else '',
        b['hpDiceFaces'] if b['hpDiceFaces'] is not None else '',
        b['hpDiceBonus'] if b['hpDiceBonus'] is not None else '',
        'true' if b['canHover'] else 'false',
        b['scores'].get('STRENGTH', ''), b['scores'].get('DEXTERITY', ''),
        b['scores'].get('CONSTITUTION', ''), b['scores'].get('INTELLIGENCE', ''),
        b['scores'].get('WISDOM', ''), b['scores'].get('CHARISMA', ''),
        b['passivePerception'] if b['passivePerception'] is not None else '',
        b['languages'] or '', b['telepathyFeet'] if b['telepathyFeet'] is not None else '',
        b['challengeRating'] if b['challengeRating'] is not None else '',
        b['experiencePoints'] if b['experiencePoints'] is not None else '',
        b['proficiencyBonus'] if b['proficiencyBonus'] is not None else '',
        b['legendaryActionUses'] if b['legendaryActionUses'] is not None else '',
    ])
    for mode, feet in sorted(b['speeds'].items()):
        speeds.append([sb, mode, feet])
    for ability, bonus in sorted(b['saves'].items()):
        saves.append([sb, ability, bonus])
    for skill, bonus in sorted(b['skills'].items()):
        skills.append([sb, skill, bonus])
    for sense, feet in sorted(b['senses'].items()):
        senses.append([sb, sense, feet])
    for d in b['damageResponses']:
        damage.append([sb, d['damageType'], d['response']])
    for c in sorted(set(b['conditionImmunities'])):
        if c in condition_ids:
            immunities.append([sb, condition_ids[c]])
    for g in b['gear']:
        gear.append([sb, g['name'], g['quantity']])

    # A Multiattack's components point at the block's other features by name;
    # this is how a name becomes the id the foreign key needs.
    ordinals = {}
    for f in b['features']:
        ordinals.setdefault(f['name'], f['ordinal'])

    for f in b['features']:
        fid = uid('feature', b['name'], f['ordinal'], f['name'])
        for ci, c in enumerate(f.get('components', [])):
            target = c['feature']
            components.append([
                uid('component', b['name'], f['ordinal'], f['name'], ci),
                STAMP, STAMP, 0, fid,
                uid('feature', b['name'], ordinals[target], target),
                c['count'], 'true' if c['optional'] else 'false', c['mode'],
                c['choiceGroup'] if c['choiceGroup'] is not None else '', ci])
        features.append([
            fid, STAMP, STAMP, 0, f['name'], f['description'], f['ordinal'], sb,
            f['activation'],
            f['legendaryCost'] if f['legendaryCost'] is not None else '',
            f['triggerText'] or '', 'false',
            f['usesReset'], f['usesMax'] if f['usesMax'] is not None else '',
            f['rechargeMin'] if f['rechargeMin'] is not None else '',
            f['rechargeMax'] if f['rechargeMax'] is not None else '',
        ])
        for si, st in enumerate(f['steps']):
            sid = uid('step', b['name'], f['ordinal'], f['name'], si)
            steps.append([
                sid, STAMP, STAMP, 0, fid, si, st['precondition'], st['targetFilter'] or '',
                st['delivery'], st['attackKind'] or '',
                st['attackBonus'] if st['attackBonus'] is not None else '',
                'FIXED' if st['attackBonus'] is not None else '',
                st['reachFeet'] if st['reachFeet'] is not None else '',
                st['rangeFeet'] if st['rangeFeet'] is not None else '',
                st['rangeLongFeet'] if st['rangeLongFeet'] is not None else '',
                st['saveAbility'] or '', st['saveDc'] if st['saveDc'] is not None else '',
                'FIXED' if st['saveDc'] is not None else '',
            ])
            for k, e in enumerate(st['effects']):
                effects.append([
                    uid('effect', b['name'], f['ordinal'], f['name'], si, k),
                    STAMP, STAMP, 0, sid, e['outcome'], e['kind'], k,
                    e['diceCount'] if e['diceCount'] is not None else '',
                    e['diceFaces'] if e['diceFaces'] is not None else '',
                    e['diceBonus'] if e['diceBonus'] is not None else '',
                    e['diceAverage'] if e['diceAverage'] is not None else '',
                    e['damageType'] or '',
                    'true' if e['halfDamage'] else 'false',
                    condition_ids.get(e['conditionName'] or '', ''),
                    e['escapeDc'] if e['escapeDc'] is not None else '',
                    e['notes'] or '',
                ])

print('writing CSVs:')
write(STEPS, 'feature-steps.csv',
      ['id', 'created_at', 'updated_at', 'version', 'feature_id', 'ordinal', 'step_trigger',
       'target_filter', 'delivery', 'attack_kind', 'attack_bonus', 'attack_bonus_source',
       'reach_feet', 'range_feet', 'range_long_feet', 'save_ability', 'save_dc', 'save_dc_source'],
      steps)
write(COMPONENTS, 'feature-components.csv',
      ['id', 'created_at', 'updated_at', 'version', 'feature_id', 'references_feature_id',
       'count', 'optional', 'mode', 'choice_group', 'ordinal'],
      components)
write(STEPS, 'effects.csv',
      ['id', 'created_at', 'updated_at', 'version', 'step_id', 'outcome', 'kind', 'ordinal',
       'dice_count', 'dice_faces', 'dice_bonus', 'dice_average', 'damage_type', 'half_damage',
       'condition_id', 'escape_dc', 'notes'],
      effects)
