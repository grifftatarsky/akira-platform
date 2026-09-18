"""Turn the parsed equipment and magic items into Liquibase load-data CSVs.

Ids are UUIDv5 of the item's name, in the same namespace the bestiary uses, so
re-running the parser against the same PDF produces byte-identical files: the
CSVs review as a diff, and a parser fix shows as a change to the rows it affects
rather than as 440 new ids.
"""
import csv
import json
import os
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '031')
NS = uuid.UUID('5bd10000-0000-4000-a000-000000000000')  # the SRD import namespace
STAMP = '2026-09-08T00:00:00'  # Liquibase's loadData DATE parser wants ISO_LOCAL_DATE_TIME
NULL = 'NULL'  # matches nullPlaceholder in 031-seed-items.yaml

# 012-seed-reference.yaml's fixed ids; the weapons table's Mastery column is a
# foreign key to them, which is the one relationship the SRD prints as a column.
MASTERY_IDS = {name: 'a5700000-0000-4000-a000-00000000000%d' % (n + 1) for n, name in enumerate(
    ('Cleave', 'Graze', 'Nick', 'Push', 'Sap', 'Slow', 'Topple', 'Vex'))}


def uid(*parts):
    return str(uuid.uuid5(NS, 'oozengine:' + ':'.join(str(p) for p in parts)))


def n(v):
    """None and empty become the placeholder loadData reads as SQL NULL."""
    return NULL if v is None or v == '' else v


def write(name, header, rows):
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, name), 'w', newline='') as fh:
        w = csv.writer(fh, quoting=csv.QUOTE_MINIMAL, lineterminator='\n')
        w.writerow(header)
        w.writerows([[n(c) for c in r] for r in rows])
    print('  %-34s %5d rows' % (name, len(rows)))


def main():
    items = json.load(open(os.path.join(HERE, 'items.json')))
    ids = {i['name']: uid('item', i['name']) for i in items}

    rows, properties, crafts, base_options = [], [], [], []
    for i in items:
        w = i['weapon'] or {}
        a = i['armor'] or {}
        dice = w.get('dice') or {}
        versatile = w.get('versatileDice') or {}
        item_id = ids[i['name']]
        rows.append([
            item_id, STAMP, STAMP, 0, 'SRD_5_2', i['name'], i['itemCategory'],
            i['rarityTier'], i['rarityNote'], i['appliesTo'],
            'true' if i['attunement'] else 'false', i['attunementNote'],
            i['costGp'], i['weightLb'], i['description'], i['toolAbility'],
            w.get('category'), dice.get('count'), dice.get('faces'), dice.get('bonus'),
            w.get('damageType'), versatile.get('count'), versatile.get('faces'),
            MASTERY_IDS.get(w.get('mastery')),
            w.get('rangeNormalFeet'), w.get('rangeLongFeet'), w.get('reachFeet'),
            ids.get(i['ammunitionItem']),
            a.get('category'), a.get('baseArmorClass'),
            None if not a else str(bool(a['addsDexterity'])).lower(),
            a.get('dexterityCap'), a.get('strengthRequirement'),
            None if not a else str(bool(a['stealthDisadvantage'])).lower(),
            a.get('armorClassBonus')])
        for prop in w.get('properties', []):
            properties.append([item_id, prop])
        for ref in dict.fromkeys(i['crafts']):
            if ref in ids:
                crafts.append([item_id, ids[ref]])
        for ref in dict.fromkeys(i['baseOptions']):
            if ref in ids:
                base_options.append([item_id, ids[ref]])

    print('db/changelog/data/031:')
    write('items.csv', [
        'id', 'created_at', 'updated_at', 'version', 'srd_version', 'name', 'item_category',
        'rarity_tier', 'rarity_note', 'applies_to', 'attunement', 'attunement_note', 'cost_gp',
        'weight_lb', 'description', 'tool_ability', 'weapon_category', 'weapon_dice_count',
        'weapon_dice_faces', 'weapon_dice_bonus', 'weapon_damage_type', 'versatile_dice_count',
        'versatile_dice_faces', 'mastery_id', 'range_normal_feet', 'range_long_feet',
        'weapon_reach_feet', 'ammunition_id', 'armor_category', 'base_armor_class',
        'adds_dexterity', 'dexterity_cap', 'strength_requirement', 'stealth_disadvantage',
        'armor_class_bonus'], rows)
    write('item-weapon-properties.csv', ['item_id', 'property'], properties)
    write('item-crafts.csv', ['tool_item_id', 'crafted_item_id'], crafts)
    write('item-base-options.csv', ['item_id', 'base_item_id'], base_options)


if __name__ == '__main__':
    main()
