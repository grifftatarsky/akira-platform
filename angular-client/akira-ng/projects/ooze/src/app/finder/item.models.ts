/**
 * The item vocabularies and view shapes, mirrored from `com.gpt.oozengine`.
 *
 * Kept beside `stat-block.models.ts` and for the same reason: these are closed
 * sets the SRD fixes, and a build-time generator would be more machinery than
 * six lists are worth.
 */

export const ITEM_CATEGORIES = ['WEAPON', 'ARMOR', 'SHIELD', 'AMMUNITION', 'ADVENTURING_GEAR',
  'TOOL', 'MOUNT_OR_VEHICLE', 'POTION', 'RING', 'ROD', 'SCROLL', 'STAFF', 'WAND',
  'WONDROUS_ITEM', 'OTHER'] as const;

export const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'VERY_RARE', 'LEGENDARY', 'ARTIFACT',
  'VARIES'] as const;

export const WEAPON_CATEGORIES = ['SIMPLE_MELEE', 'SIMPLE_RANGED', 'MARTIAL_MELEE',
  'MARTIAL_RANGED'] as const;

export const WEAPON_PROPERTIES = ['AMMUNITION', 'FINESSE', 'HEAVY', 'LIGHT', 'LOADING', 'RANGE',
  'REACH', 'THROWN', 'TWO_HANDED', 'VERSATILE'] as const;

export const ARMOR_CATEGORIES = ['LIGHT', 'MEDIUM', 'HEAVY', 'SHIELD'] as const;

/** Categories that carry a weapon block, and those that carry an armor block. */
export const WEAPON_LIKE = new Set<string>(['WEAPON', 'AMMUNITION']);
export const ARMOR_LIKE = new Set<string>(['ARMOR', 'SHIELD']);

export interface ItemRef {
  readonly id: string;
  readonly name: string;
}

export interface WeaponView {
  readonly category: string;
  readonly diceCount: number | null;
  readonly diceFaces: number | null;
  readonly diceBonus: number | null;
  readonly damage: string | null;
  readonly damageType: string | null;
  readonly versatileDiceCount: number | null;
  readonly versatileDiceFaces: number | null;
  readonly versatileDamage: string | null;
  readonly properties: readonly string[];
  readonly masteryId: string | null;
  readonly masteryName: string | null;
  readonly ammunition: ItemRef | null;
  readonly rangeNormalFeet: number | null;
  readonly rangeLongFeet: number | null;
  readonly reachFeet: number | null;
}

export interface ArmorView {
  readonly category: string;
  readonly baseArmorClass: number | null;
  readonly addsDexterity: boolean | null;
  readonly dexterityCap: number | null;
  readonly strengthRequirement: number | null;
  readonly stealthDisadvantage: boolean | null;
  readonly armorClassBonus: number | null;
  readonly donMinutes: number;
  readonly doffMinutes: number;
}

/**
 * The Armor table's AC column as the book prints it: "14 + Dex modifier (max 2)",
 * "18", "+2". Built from the parts rather than stored, so a wearer's AC stays
 * right when their Dexterity changes.
 */
export function armorClassLine(a: ArmorView | null | undefined): string {
  if (!a) return '';
  if (a.armorClassBonus != null) return `+${a.armorClassBonus}`;
  if (a.baseArmorClass == null) return '';
  if (!a.addsDexterity) return String(a.baseArmorClass);
  const cap = a.dexterityCap != null ? ` (max ${a.dexterityCap})` : '';
  return `${a.baseArmorClass} + Dex modifier${cap}`;
}

/** The Weapons table's Damage column: "1d8 Slashing", "1d8 Slashing (1d10 versatile)". */
export function weaponDamageLine(w: WeaponView | null | undefined): string {
  if (!w?.damage) return '';
  const type = w.damageType ? ` ${titleCaseWord(w.damageType)}` : '';
  const versatile = w.versatileDamage ? ` (${w.versatileDamage} versatile)` : '';
  return `${w.damage}${type}${versatile}`;
}

/** The range the book prints beside a weapon's properties. */
export function weaponRangeLine(w: WeaponView | null | undefined): string {
  if (!w) return '';
  if (w.rangeNormalFeet != null) {
    return `${w.rangeNormalFeet}/${w.rangeLongFeet ?? w.rangeNormalFeet} ft.`;
  }
  return w.reachFeet != null ? `reach ${w.reachFeet} ft.` : '';
}

function titleCaseWord(v: string): string {
  return v.charAt(0) + v.slice(1).toLowerCase();
}
