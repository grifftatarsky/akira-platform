import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, distinctUntilChanged, switchMap, timer } from 'rxjs';
import { ContentService } from './content.service';
import { CatalogItem, titleCase } from './ooze-content.models';
import {
  ARMOR_CATEGORIES,
  ARMOR_LIKE,
  ArmorView,
  ItemRef,
  WEAPON_CATEGORIES,
  WEAPON_LIKE,
  WEAPON_PROPERTIES,
  WeaponView,
} from './item.models';

/**
 * The mechanical half of an item: the Weapons table's row, the Armor table's
 * row, and the links the book prints as cross-references.
 *
 * The generic label/value form can carry a name and a price, and that is all a
 * Longsword used to keep through an edit — correcting a typo in one dropped its
 * damage, its properties and its mastery, because the request had nowhere to
 * put them. This owns that shape, the way the stat block editor owns a
 * creature's.
 *
 * It does not save. The panel around it reads {@link value} on submit, so there
 * is one request path for every content type.
 */
@Component({
  selector: 'ooze-item-editor',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './item-editor.html',
})
export class ItemEditor {
  private readonly fb = inject(FormBuilder);
  private readonly content = inject(ContentService);

  readonly item = input<CatalogItem | null>(null);
  /** The category the panel's own form currently holds, so the right block shows. */
  readonly category = input<string>('');

  protected readonly weaponCategories = WEAPON_CATEGORIES;
  protected readonly weaponProperties = WEAPON_PROPERTIES;
  protected readonly armorCategories = ARMOR_CATEGORIES;
  protected readonly damageTypes = ['ACID', 'BLUDGEONING', 'COLD', 'FIRE', 'FORCE', 'LIGHTNING',
    'NECROTIC', 'PIERCING', 'POISON', 'PSYCHIC', 'RADIANT', 'SLASHING', 'THUNDER'] as const;
  protected readonly label = titleCase;

  protected readonly showWeapon = computed(() => WEAPON_LIKE.has(this.category()));
  protected readonly showArmor = computed(() => ARMOR_LIKE.has(this.category()));

  /** The eight mastery properties, for the weapon's Mastery column. */
  protected readonly masteries = signal<readonly CatalogItem[]>([]);
  /** The five kinds of ammunition, for what a ranged weapon spends. */
  protected readonly ammunition = signal<readonly CatalogItem[]>([]);

  /** Cross-references, edited as chips rather than as a 440-row multi-select. */
  protected readonly crafts = signal<readonly ItemRef[]>([]);
  protected readonly baseOptions = signal<readonly ItemRef[]>([]);
  protected readonly linkTarget = signal<'crafts' | 'baseOptions'>('crafts');
  protected readonly linkSearch = signal('');
  protected readonly linkResults = signal<readonly ItemRef[]>([]);

  protected readonly form: FormGroup = this.fb.group({
    weaponCategory: [null as string | null],
    diceCount: [null as number | null],
    diceFaces: [null as number | null],
    diceBonus: [null as number | null],
    damageType: [null as string | null],
    versatileDiceCount: [null as number | null],
    versatileDiceFaces: [null as number | null],
    masteryId: [null as string | null],
    ammunitionId: [null as string | null],
    rangeNormalFeet: [null as number | null],
    rangeLongFeet: [null as number | null],
    reachFeet: [null as number | null],
    armorCategory: [null as string | null],
    baseArmorClass: [null as number | null],
    addsDexterity: [false],
    dexterityCap: [null as number | null],
    strengthRequirement: [null as number | null],
    stealthDisadvantage: [false],
    armorClassBonus: [null as number | null],
  });

  /** Weapon properties are a set, so they sit outside the form as a signal. */
  protected readonly properties = signal<ReadonlySet<string>>(new Set());

  constructor() {
    // Both lists are closed sets a dozen rows long; one page holds each.
    this.content.list('weapon-mastery', { size: 50 }).subscribe({
      next: page => this.masteries.set(page.content),
      error: () => this.masteries.set([]),
    });
    this.content.byCategory('AMMUNITION').subscribe({
      next: rows => this.ammunition.set(rows),
      error: () => this.ammunition.set([]),
    });

    effect(() => {
      const item = this.item();
      untracked(() => this.populate(item));
    });

    toObservable(this.linkSearch)
      .pipe(
        distinctUntilChanged(),
        switchMap(q =>
          q.trim().length < 2
            ? EMPTY
            : timer(220).pipe(
                switchMap(() =>
                  this.content
                    .list('item', { size: 12, query: q.trim() })
                    .pipe(catchError(() => EMPTY)),
                ),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(page =>
        this.linkResults.set(page.content.map(i => ({ id: i.id, name: i.name }))),
      );
  }

  /** What the panel merges into the save body. */
  value(): Record<string, unknown> {
    const v = this.form.getRawValue();
    return {
      weapon: this.showWeapon() && v.weaponCategory
        ? {
            category: v.weaponCategory,
            diceCount: v.diceCount,
            diceFaces: v.diceFaces,
            diceBonus: v.diceBonus,
            damageType: v.damageType,
            versatileDiceCount: v.versatileDiceCount,
            versatileDiceFaces: v.versatileDiceFaces,
            properties: [...this.properties()],
            masteryId: v.masteryId || null,
            ammunitionId: v.ammunitionId || null,
            rangeNormalFeet: v.rangeNormalFeet,
            rangeLongFeet: v.rangeLongFeet,
            reachFeet: v.reachFeet,
          }
        : null,
      armor: this.showArmor() && v.armorCategory
        ? {
            category: v.armorCategory,
            baseArmorClass: v.baseArmorClass,
            addsDexterity: v.addsDexterity,
            dexterityCap: v.dexterityCap,
            strengthRequirement: v.strengthRequirement,
            stealthDisadvantage: v.stealthDisadvantage,
            armorClassBonus: v.armorClassBonus,
          }
        : null,
      // Sent every time, not only when edited: the request is the whole item,
      // so a payload that left these out would detach them on save.
      craftIds: this.crafts().map(c => c.id),
      baseOptionIds: this.baseOptions().map(b => b.id),
    };
  }

  protected toggleProperty(property: string): void {
    this.properties.update(set => {
      const next = new Set(set);
      if (!next.delete(property)) next.add(property);
      return next;
    });
  }

  protected hasProperty(property: string): boolean {
    return this.properties().has(property);
  }

  protected addLink(ref: ItemRef): void {
    const signalRef = this.linkTarget() === 'crafts' ? this.crafts : this.baseOptions;
    if (!signalRef().some(r => r.id === ref.id)) {
      signalRef.update(list => [...list, ref].sort((a, b) => a.name.localeCompare(b.name)));
    }
    this.linkSearch.set('');
    this.linkResults.set([]);
  }

  protected removeLink(target: 'crafts' | 'baseOptions', id: string): void {
    const signalRef = target === 'crafts' ? this.crafts : this.baseOptions;
    signalRef.update(list => list.filter(r => r.id !== id));
  }

  private populate(item: CatalogItem | null): void {
    const w = (item?.['weapon'] ?? null) as WeaponView | null;
    const a = (item?.['armor'] ?? null) as ArmorView | null;
    this.form.reset({
      weaponCategory: w?.category ?? null,
      diceCount: w?.diceCount ?? null,
      diceFaces: w?.diceFaces ?? null,
      diceBonus: w?.diceBonus ?? null,
      damageType: w?.damageType ?? null,
      versatileDiceCount: w?.versatileDiceCount ?? null,
      versatileDiceFaces: w?.versatileDiceFaces ?? null,
      masteryId: w?.masteryId ?? null,
      ammunitionId: w?.ammunition?.id ?? null,
      rangeNormalFeet: w?.rangeNormalFeet ?? null,
      rangeLongFeet: w?.rangeLongFeet ?? null,
      reachFeet: w?.reachFeet ?? null,
      armorCategory: a?.category ?? null,
      baseArmorClass: a?.baseArmorClass ?? null,
      addsDexterity: a?.addsDexterity ?? false,
      dexterityCap: a?.dexterityCap ?? null,
      strengthRequirement: a?.strengthRequirement ?? null,
      stealthDisadvantage: a?.stealthDisadvantage ?? false,
      armorClassBonus: a?.armorClassBonus ?? null,
    });
    this.properties.set(new Set(w?.properties ?? []));
    this.crafts.set(((item?.['crafts'] ?? []) as ItemRef[]).slice());
    this.baseOptions.set(((item?.['baseOptions'] ?? []) as ItemRef[]).slice());
    this.linkSearch.set('');
    this.linkResults.set([]);
  }
}
