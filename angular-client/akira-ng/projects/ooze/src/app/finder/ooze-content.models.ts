/**
 * Schema-driven catalog. Each content type is described by a {@link ContentTypeDef}
 * — its fields, how to label/group/subtitle items — and the generic finder,
 * service, and panel render everything from these. Adding a backed type is a
 * matter of adding a def (plus its backend slice).
 */

import {
  ArmorView,
  ItemRef,
  WeaponView,
  armorClassLine,
  weaponDamageLine,
  weaponRangeLine,
} from './item.models';

export type FieldKind = 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'list';

export interface FieldOption {
  readonly value: string | number;
  readonly label: string;
}

export interface FieldDef {
  /** Matches the backend DTO property name. */
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  /** `meta` → compact label/value grid; `prose` → full-width text block. */
  readonly group: 'meta' | 'prose';
  readonly options?: readonly FieldOption[];
  readonly required?: boolean;
  readonly min?: number;
  readonly max?: number;
  /**
   * Derives what the detail pane shows, for a value the DTO nests rather than
   * holds flat — a weapon's damage, an armor's AC formula. A field with one is
   * display-only: there is no single control that could edit it back, so the
   * type brings its own editor for that part instead.
   */
  readonly value?: (item: CatalogItem) => string;
}

/**
 * Which SRD a row's rules came from. Null means it isn't SRD content — a DM's
 * own creation — and such rows are never filtered out by the edition toggle.
 */
export type SrdVersion = 'SRD_5_2' | 'SRD_5_1';

function weaponView(i: CatalogItem): WeaponView | null {
  return (i['weapon'] as WeaponView | undefined) ?? null;
}

function armorView(i: CatalogItem): ArmorView | null {
  return (i['armor'] as ArmorView | undefined) ?? null;
}

function refNames(refs: unknown): string {
  return Array.isArray(refs) ? (refs as ItemRef[]).map(r => r.name).join(', ') : '';
}

/** A row from any catalog endpoint. Always has these; other keys are per-type. */
export interface CatalogItem {
  readonly id: string;
  readonly name: string;
  readonly base: boolean;
  readonly overridesId: string | null;
  readonly srdVersion: SrdVersion | null;
  readonly [key: string]: unknown;
}

export interface ListGroup {
  readonly key: string | number;
  readonly label: string;
  readonly order: number;
}

export interface ContentTypeDef {
  readonly key: string;
  readonly title: string;
  /** REST path under /bff/ooz, e.g. "spell". */
  readonly apiPath: string;
  /** 24×24 stroked SVG path for the folder glyph. */
  readonly iconPath: string;
  readonly description: string;
  readonly implemented: boolean;
  readonly fields: readonly FieldDef[];
  /** Secondary line under the name (detail + list). */
  readonly subtitle?: (item: CatalogItem) => string;
  /** Optional list grouping (e.g. spells by level). */
  readonly group?: (item: CatalogItem) => ListGroup;
}

// region vocabularies
//
// Declared before the option sets that use them: these are module-level consts,
// so a use above its declaration is a temporal dead zone error at load, not a
// compile error.

/** ORIGIN → Origin, VERY_RARE → Very Rare, SLEIGHT_OF_HAND → Sleight Of Hand. */
export const titleCase = (s: string): string =>
  s
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

/** Turns enum constants into select options with readable labels. */
const enumOptions = (...values: readonly string[]): readonly FieldOption[] =>
  values.map(v => ({ value: v, label: titleCase(v) }));

/** Prepends an empty choice for a select whose value is optional. */
const optional = (options: readonly FieldOption[]): readonly FieldOption[] => [
  { value: '', label: '—' },
  ...options,
];

const SCHOOL_OPTIONS = enumOptions('ABJURATION', 'CONJURATION', 'DIVINATION', 'ENCHANTMENT',
  'EVOCATION', 'ILLUSION', 'NECROMANCY', 'TRANSMUTATION');

const LEVEL_OPTIONS: readonly FieldOption[] = [
  { value: 0, label: 'Cantrip' },
  ...Array.from({ length: 9 }, (_, i) => ({ value: i + 1, label: `Level ${i + 1}` })),
];

const SIZE_OPTIONS = enumOptions('TINY', 'SMALL', 'MEDIUM', 'LARGE', 'HUGE', 'GARGANTUAN');

const CREATURE_TYPE_OPTIONS = enumOptions('ABERRATION', 'BEAST', 'CELESTIAL', 'CONSTRUCT',
  'DRAGON', 'ELEMENTAL', 'FEY', 'FIEND', 'GIANT', 'HUMANOID', 'MONSTROSITY', 'OOZE',
  'PLANT', 'UNDEAD');

const ALIGNMENT_OPTIONS = enumOptions('LAWFUL_GOOD', 'NEUTRAL_GOOD', 'CHAOTIC_GOOD',
  'LAWFUL_NEUTRAL', 'NEUTRAL', 'CHAOTIC_NEUTRAL', 'LAWFUL_EVIL', 'NEUTRAL_EVIL',
  'CHAOTIC_EVIL', 'UNALIGNED', 'ANY');

const CASTER_OPTIONS = enumOptions('NONE', 'FULL', 'HALF', 'THIRD', 'PACT');

const ABILITY_OPTIONS = enumOptions('STRENGTH', 'DEXTERITY', 'CONSTITUTION',
  'INTELLIGENCE', 'WISDOM', 'CHARISMA');

const FEAT_CATEGORY_OPTIONS = enumOptions('ORIGIN', 'GENERAL', 'FIGHTING_STYLE', 'EPIC_BOON');

const ITEM_CATEGORY_OPTIONS: readonly FieldOption[] = [
  ...enumOptions('WEAPON', 'ARMOR', 'SHIELD', 'AMMUNITION'),
  { value: 'ADVENTURING_GEAR', label: 'Adventuring Gear' },
  { value: 'POISON', label: 'Poison' },
  { value: 'TOOL', label: 'Tool' },
  { value: 'MOUNT_OR_VEHICLE', label: 'Mount or Vehicle' },
  ...enumOptions('POTION', 'RING', 'ROD', 'SCROLL', 'STAFF', 'WAND'),
  { value: 'WONDROUS_ITEM', label: 'Wondrous Item' },
  { value: 'OTHER', label: 'Other' },
];

const TOOL_ABILITY_OPTIONS = optional(ABILITY_OPTIONS);

const GLOSSARY_CATEGORY_OPTIONS = optional(
  enumOptions('ACTION', 'HAZARD', 'AREA_OF_EFFECT', 'ATTITUDE', 'ENVIRONMENT', 'CONTAGION'),
);

const POISON_TYPE_OPTIONS = optional(enumOptions('CONTACT', 'INGESTED', 'INHALED', 'INJURY'));

const TRAP_SEVERITY_OPTIONS = optional(enumOptions('NUISANCE', 'BANE', 'DEADLY'));

const RARITY_OPTIONS = optional(
  enumOptions('COMMON', 'UNCOMMON', 'RARE', 'VERY_RARE', 'LEGENDARY', 'ARTIFACT', 'VARIES'),
);

/** The six ability scores as number inputs, shared by stat blocks and characters. */
const ABILITY_FIELDS: readonly FieldDef[] = (
  [['strength', 'STR'], ['dexterity', 'DEX'], ['constitution', 'CON'],
   ['intelligence', 'INT'], ['wisdom', 'WIS'], ['charisma', 'CHA']] as const
).map(([key, label]) => ({ key, label, kind: 'number' as const, group: 'meta' as const, min: 1, max: 30 }));

// endregion

export const CONTENT_TYPES: readonly ContentTypeDef[] = [
  {
    key: 'spells',
    title: 'Spells',
    apiPath: 'spell',
    iconPath: 'M12 2l1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z',
    description: 'The grimoire, by level and school.',
    implemented: true,
    fields: [
      { key: 'level', label: 'Level', kind: 'select', group: 'meta', required: true, options: LEVEL_OPTIONS },
      { key: 'school', label: 'School', kind: 'select', group: 'meta', required: true, options: SCHOOL_OPTIONS },
      { key: 'castingTime', label: 'Casting time', kind: 'text', group: 'meta' },
      { key: 'range', label: 'Range', kind: 'text', group: 'meta' },
      { key: 'duration', label: 'Duration', kind: 'text', group: 'meta' },
      { key: 'verbalComponent', label: 'Verbal', kind: 'boolean', group: 'meta' },
      { key: 'somaticComponent', label: 'Somatic', kind: 'boolean', group: 'meta' },
      { key: 'materialComponent', label: 'Material', kind: 'boolean', group: 'meta' },
      { key: 'concentration', label: 'Concentration', kind: 'boolean', group: 'meta' },
      { key: 'ritual', label: 'Ritual', kind: 'boolean', group: 'meta' },
      { key: 'materials', label: 'Materials', kind: 'text', group: 'meta' },
      { key: 'description', label: 'Description', kind: 'textarea', group: 'prose', required: true },
      { key: 'atHigherLevels', label: 'At higher levels', kind: 'textarea', group: 'prose' },
    ],
    subtitle: i => {
      const lvl = Number(i['level']);
      const school = titleCase(String(i['school'] ?? ''));
      return `${lvl === 0 ? 'Cantrip' : `Level ${lvl}`}${school ? ` · ${school}` : ''}`;
    },
    group: i => {
      const lvl = Number(i['level']);
      return { key: lvl, label: lvl === 0 ? 'Cantrips' : `Level ${lvl}`, order: lvl };
    },
  },
  {
    key: 'items',
    title: 'Items & gear',
    apiPath: 'item',
    iconPath: 'M5 8h14v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM9 8a3 3 0 0 1 6 0',
    description: 'Weapons, armor, tools, gear, and magic items.',
    implemented: true,
    fields: [
      { key: 'itemCategory', label: 'Category', kind: 'select', group: 'meta', required: true, options: ITEM_CATEGORY_OPTIONS },
      { key: 'rarityTier', label: 'Rarity', kind: 'select', group: 'meta', options: RARITY_OPTIONS },
      { key: 'rarityNote', label: 'Rarities', kind: 'text', group: 'meta' },
      { key: 'appliesTo', label: 'Applies to', kind: 'text', group: 'meta' },
      { key: 'costGp', label: 'Cost (gp)', kind: 'number', group: 'meta', min: 0 },
      { key: 'weightLb', label: 'Weight (lb)', kind: 'number', group: 'meta', min: 0 },
      { key: 'attunement', label: 'Requires attunement', kind: 'boolean', group: 'meta' },
      { key: 'attunementNote', label: 'Attunement', kind: 'text', group: 'meta' },
      { key: 'toolAbility', label: 'Tool ability', kind: 'select', group: 'meta', options: TOOL_ABILITY_OPTIONS },
      { key: 'poisonType', label: 'Delivery', kind: 'select', group: 'meta', options: POISON_TYPE_OPTIONS },
      // Display-only: the item editor owns these, because none of them is a
      // value one input could put back.
      { key: 'weaponCategory', label: 'Weapon', kind: 'list', group: 'meta',
        value: i => weaponView(i) ? titleCase(weaponView(i)!.category) : '' },
      { key: 'weaponDamage', label: 'Damage', kind: 'list', group: 'meta',
        value: i => weaponDamageLine(weaponView(i)) },
      { key: 'weaponRange', label: 'Range', kind: 'list', group: 'meta',
        value: i => weaponRangeLine(weaponView(i)) },
      { key: 'weaponProperties', label: 'Properties', kind: 'list', group: 'meta',
        value: i => (weaponView(i)?.properties ?? []).map(titleCase).join(', ') },
      { key: 'masteryName', label: 'Mastery', kind: 'list', group: 'meta',
        value: i => weaponView(i)?.masteryName ?? '' },
      { key: 'ammunition', label: 'Ammunition', kind: 'list', group: 'meta',
        value: i => weaponView(i)?.ammunition?.name ?? '' },
      { key: 'armorCategory', label: 'Armor', kind: 'list', group: 'meta',
        value: i => armorView(i) ? titleCase(armorView(i)!.category) : '' },
      { key: 'armorClass', label: 'Armor Class', kind: 'list', group: 'meta',
        value: i => armorClassLine(armorView(i)) },
      { key: 'armorStrength', label: 'Strength', kind: 'list', group: 'meta',
        value: i => { const s = armorView(i)?.strengthRequirement; return s ? `Str ${s}` : ''; } },
      { key: 'armorStealth', label: 'Stealth', kind: 'list', group: 'meta',
        value: i => (armorView(i)?.stealthDisadvantage ? 'Disadvantage' : '') },
      { key: 'donDoff', label: 'Don / doff', kind: 'list', group: 'meta',
        value: i => {
          const a = armorView(i);
          if (!a) return '';
          return a.donMinutes === 0
            ? 'Utilize action'
            : `${a.donMinutes} min / ${a.doffMinutes} min`;
        } },
      { key: 'crafts', label: 'Crafts', kind: 'list', group: 'meta',
        value: i => refNames(i['crafts']) },
      { key: 'baseOptions', label: 'Base items', kind: 'list', group: 'meta',
        value: i => refNames(i['baseOptions']) },
      { key: 'description', label: 'Description', kind: 'textarea', group: 'prose' },
    ],
    subtitle: i => {
      const cat = titleCase(String(i['itemCategory'] ?? ''));
      const rarity = i['rarityTier'] ? titleCase(String(i['rarityTier'])) : '';
      return rarity ? `${cat} · ${rarity}` : cat;
    },
    group: i => {
      const cat = titleCase(String(i['itemCategory'] ?? 'OTHER'));
      return { key: cat, label: cat, order: 0 };
    },
  },
  {
    key: 'backgrounds',
    title: 'Backgrounds',
    apiPath: 'background',
    iconPath: 'M6.5 4h11v16h-11zM9 9h6M9 13h6',
    description: 'Origins, proficiencies, and a feat.',
    implemented: true,
    fields: [
      { key: 'abilityScores', label: 'Ability scores', kind: 'list', group: 'meta' },
      { key: 'featName', label: 'Origin feat', kind: 'list', group: 'meta' },
      { key: 'featNote', label: 'Feat choice', kind: 'text', group: 'meta' },
      { key: 'skillProficiencies', label: 'Skills', kind: 'list', group: 'meta' },
      { key: 'toolProficiencies', label: 'Tools', kind: 'text', group: 'meta' },
      { key: 'equipment', label: 'Equipment', kind: 'textarea', group: 'prose' },
      { key: 'description', label: 'Description', kind: 'textarea', group: 'prose', required: true },
    ],
    subtitle: i => (Array.isArray(i['abilityScores'])
      ? (i['abilityScores'] as string[]).map(titleCase).join(', ')
      : ''),
  },
  {
    key: 'species',
    title: 'Species',
    apiPath: 'species',
    iconPath: 'M5 19c0-7 5-13 14-14 1 9-5 15-14 14zM8 16l8-8',
    description: 'Ancestries and their traits.',
    implemented: true,
    fields: [
      { key: 'size', label: 'Size', kind: 'select', group: 'meta', options: SIZE_OPTIONS },
      { key: 'alternateSize', label: 'Or size', kind: 'select', group: 'meta', options: optional(SIZE_OPTIONS) },
      { key: 'walkSpeed', label: 'Speed (ft)', kind: 'number', group: 'meta', min: 0, max: 200 },
      { key: 'creatureType', label: 'Type', kind: 'select', group: 'meta', options: CREATURE_TYPE_OPTIONS },
      { key: 'description', label: 'Description', kind: 'textarea', group: 'prose' },
    ],
    subtitle: i => [i['size'], i['creatureType']].filter(Boolean).map(v => titleCase(String(v))).join(' '),
  },
  {
    key: 'classes',
    title: 'Classes',
    apiPath: 'vocation',
    iconPath: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
    description: 'The twelve classes, level by level.',
    implemented: true,
    fields: [
      { key: 'primaryAbilities', label: 'Primary ability', kind: 'list', group: 'meta' },
      { key: 'hitDie', label: 'Hit die (d)', kind: 'number', group: 'meta', min: 4, max: 12 },
      { key: 'savingThrowProficiencies', label: 'Saving throws', kind: 'list', group: 'meta' },
      { key: 'skillChoices', label: 'Skill choices', kind: 'number', group: 'meta', min: 0, max: 18 },
      { key: 'skillOptions', label: 'Skills', kind: 'list', group: 'meta' },
      { key: 'armorTraining', label: 'Armor training', kind: 'list', group: 'meta' },
      { key: 'weaponProficiencies', label: 'Weapons', kind: 'text', group: 'meta' },
      { key: 'toolProficiencies', label: 'Tools', kind: 'text', group: 'meta' },
      { key: 'casterProgression', label: 'Spellcasting', kind: 'select', group: 'meta', options: CASTER_OPTIONS },
      { key: 'spellcastingAbility', label: 'Casting ability', kind: 'select', group: 'meta', options: optional(ABILITY_OPTIONS) },
      { key: 'complexity', label: 'Complexity', kind: 'text', group: 'meta' },
      { key: 'likes', label: 'Likes', kind: 'text', group: 'meta' },
      { key: 'startingEquipment', label: 'Starting equipment', kind: 'textarea', group: 'prose' },
      { key: 'description', label: 'Description', kind: 'textarea', group: 'prose' },
    ],
    subtitle: i => {
      const abilities = Array.isArray(i['primaryAbilities'])
        ? (i['primaryAbilities'] as string[]).map(titleCase).join(' / ')
        : '';
      const die = i['hitDie'] ? `d${i['hitDie']}` : '';
      return [abilities, die].filter(Boolean).join(' · ');
    },
    group: i => {
      const caster = String(i['casterProgression'] ?? 'NONE');
      const label = caster === 'NONE' ? 'Martial' : 'Spellcasters';
      return { key: label, label, order: caster === 'NONE' ? 0 : 1 };
    },
  },
  {
    key: 'bestiary',
    title: 'Bestiary',
    apiPath: 'monster',
    iconPath: 'M7 4c1.2 5 1.2 11 0 16M12 4c1.2 5 1.2 11 0 16M17 4c1.2 5 1.2 11 0 16',
    description: 'Monsters and statblocks.',
    implemented: true,
    fields: [
      { key: 'size', label: 'Size', kind: 'select', group: 'meta', options: SIZE_OPTIONS },
      { key: 'creatureType', label: 'Type', kind: 'select', group: 'meta', options: CREATURE_TYPE_OPTIONS },
      { key: 'creatureSubtype', label: 'Subtype', kind: 'text', group: 'meta' },
      { key: 'alignment', label: 'Alignment', kind: 'select', group: 'meta', options: optional(ALIGNMENT_OPTIONS) },
      { key: 'challengeRating', label: 'CR', kind: 'list', group: 'meta' },
      { key: 'armorClass', label: 'AC', kind: 'number', group: 'meta', min: 0, max: 40 },
      { key: 'hitPoints', label: 'HP', kind: 'list', group: 'meta' },
      { key: 'speed', label: 'Speed', kind: 'list', group: 'meta' },
      ...ABILITY_FIELDS,
      { key: 'description', label: 'Description', kind: 'textarea', group: 'prose' },
    ],
    subtitle: i =>
      [
        i['challengeRating'] ? `CR ${i['challengeRating']}` : '',
        [i['size'], i['creatureType']].filter(Boolean).map(v => titleCase(String(v))).join(' '),
      ]
        .filter(Boolean)
        .join(' · '),
  },
  {
    key: 'feats',
    title: 'Feats',
    apiPath: 'feat',
    iconPath: 'M12 3l2.2 4.8 5.3.5-4 3.6 1.2 5.1L12 14.8 7.3 17l1.2-5.1-4-3.6 5.3-.5z',
    description: 'Origin, general, and epic boons.',
    implemented: true,
    fields: [
      { key: 'category', label: 'Category', kind: 'select', group: 'meta', required: true, options: FEAT_CATEGORY_OPTIONS },
      { key: 'prerequisite', label: 'Prerequisite', kind: 'text', group: 'meta' },
      { key: 'repeatable', label: 'Repeatable', kind: 'boolean', group: 'meta' },
      { key: 'description', label: 'Description', kind: 'textarea', group: 'prose', required: true },
    ],
    subtitle: i =>
      [titleCase(String(i['category'] ?? '')), i['prerequisite'] ? `Prereq: ${i['prerequisite']}` : '']
        .filter(Boolean)
        .join(' · '),
    group: i => {
      const cat = titleCase(String(i['category'] ?? 'OTHER'));
      return { key: cat, label: cat, order: 0 };
    },
  },
  {
    key: 'conditions',
    title: 'Conditions',
    apiPath: 'condition',
    iconPath: 'M3 12h4l2.5 7 5-14 2.5 7h4',
    description: 'Blinded, Prone, Stunned, and the rest.',
    implemented: true,
    fields: [
      { key: 'code', label: 'Rule', kind: 'list', group: 'meta' },
      { key: 'description', label: 'Effect', kind: 'textarea', group: 'prose', required: true },
    ],
  },
  {
    key: 'weapon-mastery',
    title: 'Weapon Mastery',
    apiPath: 'weapon-mastery',
    iconPath: 'M14.5 3.5 21 10l-2 2-6.5-6.5zM3 21l6-6M9 9l-6 6 3 3 6-6',
    description: 'Cleave, Topple, Vex, and more.',
    implemented: true,
    fields: [
      { key: 'code', label: 'Rule', kind: 'list', group: 'meta' },
      { key: 'description', label: 'Effect', kind: 'textarea', group: 'prose', required: true },
    ],
  },
  {
    key: 'traps',
    title: 'Traps',
    apiPath: 'trap',
    iconPath: 'M4 6h16M6 6v4l6 8 6-8V6M9 6v3M15 6v3',
    description: 'Triggers, severities, and what they do to you.',
    implemented: true,
    fields: [
      { key: 'severity', label: 'Severity', kind: 'select', group: 'meta', options: TRAP_SEVERITY_OPTIONS },
      { key: 'levelBand', label: 'Levels', kind: 'text', group: 'meta' },
      { key: 'severityNote', label: 'As printed', kind: 'text', group: 'meta' },
      { key: 'duration', label: 'Duration', kind: 'text', group: 'meta' },
      { key: 'trigger', label: 'Trigger', kind: 'textarea', group: 'prose' },
      { key: 'description', label: 'Description', kind: 'textarea', group: 'prose', required: true },
    ],
    subtitle: i => {
      const severity = i['severity'] ? titleCase(String(i['severity'])) : '';
      const levels = i['levelBand'] ? `Levels ${i['levelBand']}` : '';
      return [severity, levels].filter(Boolean).join(' · ');
    },
    group: i => {
      const s = titleCase(String(i['severity'] ?? 'Other'));
      // Deadliest first: a DM picking a trap is picking a threat for a tier.
      return { key: s, label: s, order: { Deadly: 0, Bane: 1, Nuisance: 2 }[s] ?? 3 };
    },
  },
  {
    key: 'glossary',
    title: 'Rules glossary',
    apiPath: 'glossary',
    iconPath: 'M5 4h13a1 1 0 0 1 1 1v15H6a2 2 0 0 1-2-2V4zM9 4v16',
    description: 'Rules terms, hazards, and the toolbox reference.',
    implemented: true,
    fields: [
      { key: 'category', label: 'Kind', kind: 'select', group: 'meta', options: GLOSSARY_CATEGORY_OPTIONS },
      { key: 'description', label: 'Definition', kind: 'textarea', group: 'prose', required: true },
    ],
    subtitle: i => (i['category'] ? titleCase(String(i['category'])) : ''),
    group: i => {
      // The book's own bracketed tags first, the plain terms after them.
      const c = i['category'] ? titleCase(String(i['category'])) : 'Terms';
      return { key: c, label: c, order: c === 'Terms' ? 1 : 0 };
    },
  },
  {
    key: 'characters',
    title: 'Characters',
    apiPath: 'character',
    iconPath: 'M8.5 8a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6',
    description: 'Your player characters and NPCs.',
    implemented: true,
    fields: [
      {
        key: 'kind',
        label: 'Type',
        kind: 'select',
        group: 'meta',
        required: true,
        options: [
          { value: 'PLAYER_CHARACTER', label: 'Player Character' },
          { value: 'NPC', label: 'NPC' },
        ],
      },
      { key: 'species', label: 'Species', kind: 'list', group: 'meta' },
      { key: 'characterClass', label: 'Class', kind: 'list', group: 'meta' },
      { key: 'subclass', label: 'Subclass', kind: 'list', group: 'meta' },
      { key: 'level', label: 'Level', kind: 'number', group: 'meta', min: 1, max: 20 },
      { key: 'background', label: 'Background', kind: 'list', group: 'meta' },
      { key: 'alignment', label: 'Alignment', kind: 'select', group: 'meta', options: optional(ALIGNMENT_OPTIONS) },
      { key: 'armorClass', label: 'AC', kind: 'number', group: 'meta', min: 0, max: 40 },
      { key: 'hitPointsAverage', label: 'HP', kind: 'number', group: 'meta', min: 0 },
      { key: 'walkSpeed', label: 'Speed (ft)', kind: 'number', group: 'meta', min: 0, max: 200 },
      ...ABILITY_FIELDS,
      { key: 'description', label: 'Description', kind: 'textarea', group: 'prose' },
      { key: 'notes', label: 'Notes', kind: 'textarea', group: 'prose' },
    ],
    subtitle: i =>
      [i['level'] ? `Level ${i['level']}` : '', i['characterClass'], i['species']]
        .filter(Boolean)
        .join(' · '),
    group: i =>
      i['kind'] === 'NPC'
        ? { key: 'NPC', label: 'NPCs', order: 1 }
        : { key: 'PC', label: 'Player Characters', order: 0 },
  },
  {
    key: 'encounters',
    title: 'Encounters',
    apiPath: 'encounter',
    iconPath: 'M4 4l16 16M20 4 4 20',
    description: 'Build and balance combats.',
    implemented: false,
    fields: [],
  },
];
