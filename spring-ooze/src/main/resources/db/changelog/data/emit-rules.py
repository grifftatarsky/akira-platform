"""Turn the parsed glossary and classes into Liquibase load-data CSVs.

Ids are UUIDv5 of a stable name in the same namespace as the rest of the import,
so re-running the parsers against the same PDF produces byte-identical files.
"""
import csv
import json
import os
import re
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
GLOSSARY = os.path.join(HERE, '033')
CLASSES = os.path.join(HERE, '034')
SPECIES = os.path.join(HERE, '035')
TOOLBOX = os.path.join(HERE, '036')
NS = uuid.UUID('5bd10000-0000-4000-a000-000000000000')  # the SRD import namespace
STAMP = '2026-09-08T00:00:00'  # loadData wants ISO_LOCAL_DATE_TIME, with no zone
NULL = 'NULL'

ARMOR = {'Light': 'LIGHT', 'Medium': 'MEDIUM', 'Heavy': 'HEAVY', 'Shield': 'SHIELD'}


def uid(*parts):
    return str(uuid.uuid5(NS, 'oozengine:' + ':'.join(str(p) for p in parts)))


def n(v):
    return NULL if v is None or v == '' else v


def write(directory, name, header, rows):
    os.makedirs(directory, exist_ok=True)
    with open(os.path.join(directory, name), 'w', newline='') as fh:
        w = csv.writer(fh, quoting=csv.QUOTE_MINIMAL, lineterminator='\n')
        w.writerow(header)
        w.writerows([[n(c) for c in r] for r in rows])
    print('  %-38s %5d rows' % (name, len(rows)))


def armor_set(text):
    """'Light, Medium, and Heavy armor and Shields' -> the four enum values."""
    if not text or text.strip() == 'None':
        return []
    found = [v for k, v in ARMOR.items() if re.search(r'\b%s' % k, text)]
    return sorted(set(found))


def emit_glossary():
    entries = json.load(open(os.path.join(HERE, 'glossary.json')))
    rows, conditions = [], []
    for e in entries:
        if e['category'] == 'CONDITION':
            # The condition's own row already exists, under an id 012 fixed; this
            # refreshes its text from the book rather than adding a second copy.
            conditions.append([e['name'], e['description']])
            continue
        rows.append([uid('glossary', e['name']), STAMP, STAMP, 0, 'SRD_5_2',
                     e['name'], e['category'], e['description']])
    print('db/changelog/data/033:')
    write(GLOSSARY, 'glossary-entries.csv',
          ['id', 'created_at', 'updated_at', 'version', 'srd_version', 'name', 'category',
           'description'], rows)
    write(GLOSSARY, 'condition-text.csv', ['name', 'description'], conditions)


def emit_classes():
    classes = json.load(open(os.path.join(HERE, 'classes.json')))
    vocations, abilities, saves, skills, armor = [], [], [], [], []
    subclasses, levels, slots, values, features, spell_links = [], [], [], [], [], []

    for c in classes:
        vid = uid('vocation', c['name'])
        vocations.append([
            vid, STAMP, STAMP, 0, 'SRD_5_2', c['name'], c['hitDie'], c['skillChoices'],
            c['casterProgression'], c['spellcastingAbility'], c['weaponProficiencies'],
            c['toolProficiencies'], c['startingEquipment']])
        for a in c['primaryAbilities']:
            abilities.append([vid, a])
        for a in c['savingThrowProficiencies']:
            saves.append([vid, a])
        for s in c['skillOptions']:
            skills.append([vid, s])
        for a in armor_set(c['armorTraining']):
            armor.append([vid, a])

        sub = c['subclass']
        sid = uid('subclass', c['name'], sub['name']) if sub else None
        if sub:
            subclasses.append([sid, STAMP, STAMP, 0, 'SRD_5_2', sub['name'], vid,
                               sub['description']])

        for row in c['levels']:
            lid = uid('vocationlevel', c['name'], row['level'])
            cantrips = row['values'].pop('Cantrips', None)
            prepared = row['values'].pop('Prepared Spells', None)
            levels.append([lid, STAMP, STAMP, 0, vid, row['level'], row['proficiencyBonus'],
                           row['features'], cantrips, prepared])
            for level, count in row['slots'].items():
                if count and count != '—':
                    slots.append([lid, int(level), int(count)])
            ordinal = 0
            for label, value in row['values'].items():
                if value and value != '—':
                    values.append([lid, ordinal, label, value])
                    ordinal += 1

        ordinal = 0
        for f in c['features'] + (sub['features'] if sub else []):
            owned_by_subclass = sub and f in sub['features']
            features.append([
                uid('vocationfeature', c['name'], f['level'], f['name']),
                STAMP, STAMP, 0, f['name'], f['description'], ordinal, vid,
                sid if owned_by_subclass else None, f['level'], 'PASSIVE', 'AT_WILL'])
            ordinal += 1

        for spell in c['spellList']:
            spell_links.append([spell, vid])

    print('db/changelog/data/034:')
    write(CLASSES, 'vocations.csv',
          ['id', 'created_at', 'updated_at', 'version', 'srd_version', 'name', 'hit_die',
           'skill_choices', 'caster_progression', 'spellcasting_ability', 'weapon_proficiencies',
           'tool_proficiencies', 'starting_equipment'], vocations)
    write(CLASSES, 'vocation-primary-abilities.csv', ['vocation_id', 'ability'], abilities)
    write(CLASSES, 'vocation-saving-throws.csv', ['vocation_id', 'ability'], saves)
    write(CLASSES, 'vocation-skill-options.csv', ['vocation_id', 'skill'], skills)
    write(CLASSES, 'vocation-armor-training.csv', ['vocation_id', 'armor_category'], armor)
    write(CLASSES, 'subclasses.csv',
          ['id', 'created_at', 'updated_at', 'version', 'srd_version', 'name', 'vocation_id',
           'description'], subclasses)
    write(CLASSES, 'vocation-levels.csv',
          ['id', 'created_at', 'updated_at', 'version', 'vocation_id', 'level',
           'proficiency_bonus', 'feature_summary', 'cantrips_known', 'prepared_spells'], levels)
    write(CLASSES, 'vocation-level-spell-slots.csv',
          ['vocation_level_id', 'slot_level', 'slots'], slots)
    write(CLASSES, 'vocation-level-values.csv',
          ['vocation_level_id', 'ordinal', 'label', 'value'], values)
    write(CLASSES, 'vocation-features.csv',
          ['id', 'created_at', 'updated_at', 'version', 'name', 'description', 'ordinal',
           'vocation_id', 'subclass_id', 'vocation_level', 'activation', 'uses_reset'], features)
    # Joined on name at load time: the spells were seeded long before this and
    # their ids aren't derivable from here.
    write(CLASSES, 'spell-vocations.csv', ['spell_name', 'vocation_id'], spell_links)


def emit_species():
    """Species and their traits, with a trait's options linked as a choice.

    The Goliath picks one giant ancestry of six and the Gnome one lineage of
    two; the book sets those options in bold inside the trait that offers them.
    They are features of their own — each has its own mechanics — joined to the
    parent by a CHOICE component, which is the same shape a Multiattack uses to
    say "one of these".
    """
    species = json.load(open(os.path.join(HERE, 'species.json')))
    rows, speeds, features, components = [], [], [], []
    for s in species:
        sid = uid('species', s['name'])
        rows.append([sid, STAMP, STAMP, 0, 'SRD_5_2', s['name'], s['size'],
                     s['alternateSize'], s['creatureType'], s['description']])
        for movement, feet in s['speeds'].items():
            speeds.append([sid, movement, feet])

        ordinal = 0
        for trait in s['traits']:
            tid = uid('speciesfeature', s['name'], trait['name'])
            features.append([tid, STAMP, STAMP, 0, trait['name'], trait['description'],
                             ordinal, sid, 'PASSIVE', 'AT_WILL'])
            ordinal += 1
            for choice, option in enumerate(trait['options']):
                oid = uid('speciesfeature', s['name'], option['name'])
                features.append([oid, STAMP, STAMP, 0, option['name'], option['description'],
                                 ordinal, sid, 'PASSIVE', 'AT_WILL'])
                ordinal += 1
                components.append([
                    uid('speciescomponent', s['name'], trait['name'], option['name']),
                    STAMP, STAMP, 0, tid, oid, 1, 'false', 'CHOICE', 0, choice])

    print('db/changelog/data/035:')
    write(SPECIES, 'species.csv',
          ['id', 'created_at', 'updated_at', 'version', 'srd_version', 'name', 'size',
           'alternate_size', 'creature_type', 'description'], rows)
    write(SPECIES, 'species-speeds.csv', ['species_id', 'movement_type', 'speed_feet'], speeds)
    write(SPECIES, 'species-features.csv',
          ['id', 'created_at', 'updated_at', 'version', 'name', 'description', 'ordinal',
           'species_id', 'activation', 'uses_reset'], features)
    write(SPECIES, 'species-trait-options.csv',
          ['id', 'created_at', 'updated_at', 'version', 'feature_id', 'references_feature_id',
           'count', 'optional', 'mode', 'choice_group', 'ordinal'], components)


def emit_toolbox():
    """The catalog-shaped parts of the Gameplay Toolbox.

    Poisons are items — the book prices them per dose — under a category of
    their own, since "Poison, Basic" already sat in Adventuring Gear and the
    fourteen samples are a different kind of thing from a Backpack. Traps get a
    table, because a trap is the third thing that can act in an encounter.
    Contagions and environmental effects are named rules with prose, so they
    join the glossary under categories of their own rather than taking a table
    apiece for three rows.
    """
    tb = json.load(open(os.path.join(HERE, 'toolbox.json')))
    poisons, traps, reference = [], [], []

    for p in tb['poisons']:
        poisons.append([uid('item', p['name']), STAMP, STAMP, 0, 'SRD_5_2', p['name'],
                        'POISON', p['costGp'], p['poisonType'], p['description']])
    for t in tb['traps']:
        traps.append([uid('trap', t['name']), STAMP, STAMP, 0, 'SRD_5_2', t['name'],
                      t['severity'], t['levelBand'], t['severityText'], t['trigger'],
                      t['duration'], t['description']])
    for category, entries in (('CONTAGION', tb['contagions']),
                              ('ENVIRONMENT', tb['environment']),
                              (None, tb['guidance'])):
        for e in entries:
            reference.append([uid('glossary', e['name']), STAMP, STAMP, 0, 'SRD_5_2',
                              e['name'], category, e['description']])

    print('db/changelog/data/036:')
    write(TOOLBOX, 'poisons.csv',
          ['id', 'created_at', 'updated_at', 'version', 'srd_version', 'name', 'item_category',
           'cost_gp', 'poison_type', 'description'], poisons)
    write(TOOLBOX, 'traps.csv',
          ['id', 'created_at', 'updated_at', 'version', 'srd_version', 'name', 'severity',
           'level_band', 'severity_note', 'trigger', 'duration', 'description'], traps)
    write(TOOLBOX, 'toolbox-reference.csv',
          ['id', 'created_at', 'updated_at', 'version', 'srd_version', 'name', 'category',
           'description'], reference)


if __name__ == '__main__':
    emit_glossary()
    emit_classes()
    emit_species()
    emit_toolbox()
