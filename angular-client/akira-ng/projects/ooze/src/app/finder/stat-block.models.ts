/**
 * The rules vocabularies, mirrored from `com.gpt.oozengine.constant.rules`.
 *
 * <p>Kept as plain string unions rather than generated: they are closed sets the
 * SRD fixes, they change only when the book does, and a build-time generator
 * would be more machinery than the six lists below are worth.
 */

export const SIZES = ['TINY', 'SMALL', 'MEDIUM', 'LARGE', 'HUGE', 'GARGANTUAN'] as const;

export const CREATURE_TYPES = ['ABERRATION', 'BEAST', 'CELESTIAL', 'CONSTRUCT', 'DRAGON',
  'ELEMENTAL', 'FEY', 'FIEND', 'GIANT', 'HUMANOID', 'MONSTROSITY', 'OOZE', 'PLANT',
  'UNDEAD'] as const;

export const ALIGNMENTS = ['LAWFUL_GOOD', 'NEUTRAL_GOOD', 'CHAOTIC_GOOD', 'LAWFUL_NEUTRAL',
  'NEUTRAL', 'CHAOTIC_NEUTRAL', 'LAWFUL_EVIL', 'NEUTRAL_EVIL', 'CHAOTIC_EVIL', 'UNALIGNED',
  'ANY'] as const;

export const ABILITIES = ['STRENGTH', 'DEXTERITY', 'CONSTITUTION', 'INTELLIGENCE', 'WISDOM',
  'CHARISMA'] as const;

export const SKILLS = ['ACROBATICS', 'ANIMAL_HANDLING', 'ARCANA', 'ATHLETICS', 'DECEPTION',
  'HISTORY', 'INSIGHT', 'INTIMIDATION', 'INVESTIGATION', 'MEDICINE', 'NATURE', 'PERCEPTION',
  'PERFORMANCE', 'PERSUASION', 'RELIGION', 'SLEIGHT_OF_HAND', 'STEALTH', 'SURVIVAL'] as const;

export const MOVEMENT_TYPES = ['WALK', 'BURROW', 'CLIMB', 'FLY', 'SWIM'] as const;

export const SENSE_TYPES = ['BLINDSIGHT', 'DARKVISION', 'TREMORSENSE', 'TRUESIGHT'] as const;

export const DAMAGE_TYPES = ['ACID', 'BLUDGEONING', 'COLD', 'FIRE', 'FORCE', 'LIGHTNING',
  'NECROTIC', 'PIERCING', 'POISON', 'PSYCHIC', 'RADIANT', 'SLASHING', 'THUNDER'] as const;

export const DAMAGE_RESPONSES = ['RESISTANCE', 'IMMUNITY', 'VULNERABILITY'] as const;

export const ACTIVATIONS = ['PASSIVE', 'ACTION', 'BONUS_ACTION', 'REACTION', 'FREE', 'LEGENDARY',
  'LAIR', 'TIMED', 'SPECIAL'] as const;

export const USES_RESETS = ['AT_WILL', 'RECHARGE', 'PER_DAY', 'SHORT_REST', 'LONG_REST', 'DAWN',
  'SPECIAL'] as const;

export const DELIVERIES = ['AUTOMATIC', 'ATTACK_ROLL', 'SAVING_THROW', 'ABILITY_CONTEST'] as const;

export const ATTACK_KINDS = ['MELEE', 'RANGED', 'MELEE_OR_RANGED'] as const;

export const AREA_SHAPES = ['CONE', 'CUBE', 'CYLINDER', 'EMANATION', 'LINE', 'SPHERE'] as const;

export const EFFECT_OUTCOMES = ['ALWAYS', 'HIT', 'CRITICAL_HIT', 'MISS', 'HIT_OR_MISS',
  'SAVE_FAILURE', 'SAVE_SUCCESS', 'SAVE_EITHER', 'FIRST_FAILURE', 'SECOND_FAILURE',
  'SUBSEQUENT_FAILURES', 'FAILURE_BY_5_OR_MORE'] as const;

/** How one line of a Multiattack combines with the others. */
export const COMPONENT_MODES = ['FIXED', 'CHOICE', 'REPLACEMENT', 'ALTERNATIVE'] as const;

/**
 * What each mode is called in the editor. Title-casing the enum gives "Fixed"
 * and "Choice", which name the implementation rather than the rule — and the
 * whole point of the field is that a DM can tell "makes both" from "picks one".
 */
export const COMPONENT_MODE_LABELS: Record<(typeof COMPONENT_MODES)[number], string> = {
  FIXED: 'Always',
  CHOICE: 'Any combination',
  REPLACEMENT: 'Can replace one',
  ALTERNATIVE: 'Or instead',
};

/** Why a step happens: a follow-up save only fires if the attack before it hit. */
export const STEP_TRIGGERS = ['ALWAYS', 'ON_PREVIOUS_HIT', 'ON_PREVIOUS_MISS',
  'ON_PREVIOUS_FAILURE', 'ON_PREVIOUS_SUCCESS'] as const;

export const EFFECT_KINDS = ['DAMAGE', 'HEALING', 'TEMPORARY_HIT_POINTS', 'APPLY_CONDITION',
  'REMOVE_CONDITION', 'MOVEMENT', 'ABILITY_SCORE_CHANGE', 'RESOURCE_CHANGE', 'SUMMON',
  'AREA_TERRAIN', 'SPECIAL'] as const;

export type Ability = (typeof ABILITIES)[number];
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export type SenseType = (typeof SENSE_TYPES)[number];
export type Skill = (typeof SKILLS)[number];

/** What `GET /monster` returns inside each row. */
export interface StatBlockView {
  readonly id?: string;
  readonly size: string | null;
  readonly creatureType: string | null;
  readonly creatureSubtype: string | null;
  readonly alignment: string | null;
  readonly armorClass: number | null;
  readonly armorClassNote: string | null;
  readonly initiativeBonus: number | null;
  readonly hitPointsAverage: number | null;
  readonly hitPointsDice: string | null;
  readonly speeds: Record<string, number>;
  readonly canHover: boolean;
  readonly abilityScores: Record<string, number>;
  readonly saveBonuses: Record<string, number>;
  readonly skills: Record<string, number>;
  readonly senses: Record<string, number>;
  readonly passivePerception: number | null;
  readonly damageResponses: readonly string[];
  readonly conditionImmunities: readonly string[];
  readonly languages: string | null;
  readonly telepathyFeet: number | null;
  readonly challengeRating: number | null;
  readonly experiencePoints: number | null;
  readonly proficiencyBonus: number | null;
  readonly spellcastingAbility: string | null;
  readonly spellSaveDc: number | null;
  readonly spellAttackBonus: number | null;
  readonly legendaryActionUses: number | null;
  readonly features: readonly FeatureView[];
  /** "At Will: Detect Magic", "1/Day Each: Finger of Death" — an allowance,
   * not slots, which is how the book gives a monster its spells. */
  readonly knownSpells: readonly KnownSpellView[];
}

export interface KnownSpellView {
  readonly spellId: string;
  readonly spellName: string;
  /** The level it is cast at, which the book sometimes raises. */
  readonly spellLevel: number;
  /** The spell's own level, so a raise can be told from the ordinary case. */
  readonly baseLevel: number;
  readonly usesReset: string;
  readonly usesMax: number | null;
}

/** The book's own grouping: one line per allowance, spells alphabetical. */
export function spellAllowances(
  spells: readonly KnownSpellView[],
): readonly { label: string; spells: string }[] {
  const bands = new Map<string, string[]>();
  for (const s of spells) {
    const label =
      s.usesReset === 'AT_WILL'
        ? 'At Will'
        : s.usesMax != null
          ? `${s.usesMax}/Day Each`
          : titleCase(s.usesReset);
    // The book annotates a level only where it raises one: "Acid Arrow (level
    // 4 version)". Printing every spell's own level is noise.
    const level = s.spellLevel > s.baseLevel ? ` (level ${s.spellLevel})` : '';
    const list = bands.get(label) ?? [];
    list.push(s.spellName + level);
    bands.set(label, list);
  }
  return [...bands].map(([label, list]) => ({ label, spells: list.join(', ') }));
}

function titleCase(v: string): string {
  return v
    .split('_')
    .map(w => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export interface FeatureView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly activation: string;
  readonly legendaryCost: number | null;
  readonly triggerText: string | null;
  readonly usesReset: string;
  readonly usesMax: number | null;
  readonly rechargeMin: number | null;
  readonly rechargeMax: number | null;
  readonly areaShape: string | null;
  readonly areaSizeFeet: number | null;
  /** Set on class features: the level that grants it, and whose subclass. */
  readonly vocationLevel?: number | null;
  readonly subclassId?: string | null;
  /** One per roll the book asks for; a chained attack-then-save is two. */
  readonly steps: readonly FeatureStepView[];
  /** Non-empty only on a Multiattack, which names the creature's own actions. */
  readonly components: readonly FeatureComponentView[];
}

export interface FeatureComponentView {
  readonly id: string;
  readonly referencedFeatureId: string;
  readonly referencedFeatureName: string;
  readonly count: number;
  readonly optional: boolean;
  readonly mode: string;
  readonly choiceGroup: number | null;
}

/**
 * A Multiattack written as the plan it is — "2 x Tentacle, then one of Consume
 * Memories or Dominate Mind" — rather than as the sentence it came from.
 *
 * The modes are not decoration: read additively, "three attacks using Shortsword
 * or Light Crossbow in any combination" becomes six attacks, and the Medusa's
 * alternative plan becomes a Medusa that takes both.
 */
export function multiattackLine(components: readonly FeatureComponentView[]): string {
  if (!components.length) return '';
  const groups: FeatureComponentView[][] = [];
  for (const c of components) {
    const open = c.choiceGroup === null ? null
      : groups.find(g => g[0].choiceGroup === c.choiceGroup && g[0].mode === c.mode);
    if (open) open.push(c);
    else groups.push([c]);
  }
  const main: string[] = [];
  const tail: string[] = [];
  for (const g of groups) {
    const names = g.map(c => c.referencedFeatureName);
    const { count, mode, optional } = g[0];
    const what = names.length > 1 ? `any of ${names.join(', ')}` : names[0];
    const times = count > 1 ? `${count} × ` : '';
    if (mode === 'REPLACEMENT') {
      tail.push(`may replace ${count} with ${what}`);
    } else if (mode === 'ALTERNATIVE') {
      tail.push(`or ${times}${what}`);
    } else {
      main.push(`${times}${what}${optional ? ' (if available)' : ''}`);
    }
  }
  return [main.join(' + '), ...tail].filter(Boolean).join('; ');
}

export interface FeatureStepView {
  readonly id: string;
  readonly ordinal: number;
  readonly trigger: string;
  readonly targetFilter: string | null;
  readonly delivery: string;
  readonly attackKind: string | null;
  readonly attackBonus: number | null;
  readonly reachFeet: number | null;
  readonly rangeFeet: number | null;
  readonly rangeLongFeet: number | null;
  readonly saveAbility: string | null;
  readonly saveDc: number | null;
  readonly effects: readonly EffectView[];
}

export interface EffectView {
  readonly id: string;
  readonly outcome: string;
  readonly kind: string;
  readonly amount: string | null;
  readonly average: number | null;
  readonly damageType: string | null;
  readonly halfDamage: boolean;
  readonly conditionId: string | null;
  readonly conditionName: string | null;
  readonly escapeDc: number | null;
  readonly notes: string | null;
}

/** Splits "2d6 + 5" back into the parts the request carries. */
export function parseDice(expr: string | null | undefined): {
  count: number | null;
  faces: number | null;
  bonus: number | null;
} {
  if (!expr) return { count: null, faces: null, bonus: null };
  const m = /^\s*(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/.exec(expr);
  if (!m) return { count: null, faces: null, bonus: null };
  const bonus = m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : null;
  return { count: Number(m[1]), faces: Number(m[2]), bonus };
}
