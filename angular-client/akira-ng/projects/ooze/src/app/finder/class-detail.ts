import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CatalogItem, titleCase } from './ooze-content.models';
import { FeatureView } from './stat-block.models';

/** One row of a class's level table, as the API returns it. */
export interface VocationLevelView {
  readonly level: number;
  readonly proficiencyBonus: number;
  readonly featureSummary: string | null;
  readonly cantripsKnown: number | null;
  readonly preparedSpells: number | null;
  readonly spellSlots: Record<string, number>;
  /** The class's own columns, in the order the book prints them. */
  readonly classValues: readonly { label: string; value: string }[];
}

export interface SubclassView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

/**
 * A class as the book lays one out: the twenty-row level table, then the
 * features in the order they are gained.
 *
 * Read-only. The generic panel edits the class header — hit die, saves, skills
 * — and the level table isn't something a form edits a cell at a time; a new
 * override copies it from the class it shadows.
 */
@Component({
  selector: 'ooze-class-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './class-detail.html',
})
export class ClassDetail {
  readonly item = input.required<CatalogItem>();

  protected readonly label = titleCase;

  protected readonly levels = computed<readonly VocationLevelView[]>(
    () => (this.item()['levels'] as VocationLevelView[] | undefined) ?? [],
  );

  protected readonly subclasses = computed<readonly SubclassView[]>(
    () => (this.item()['subclasses'] as SubclassView[] | undefined) ?? [],
  );

  protected readonly features = computed<readonly FeatureView[]>(
    () => (this.item()['features'] as FeatureView[] | undefined) ?? [],
  );

  /** Base-class features, in the order the book grants them. */
  protected readonly classFeatures = computed(() =>
    this.features().filter(f => !this.subclassIdOf(f)),
  );

  protected readonly subclassFeatures = computed(() =>
    this.features().filter(f => this.subclassIdOf(f)),
  );

  /**
   * The columns this class has that no other does — Rages, Sneak Attack, Focus
   * Points. Taken from the rows rather than declared, because that is exactly
   * what the label/value map on a level exists to allow.
   */
  protected readonly classColumns = computed(() => {
    const seen: string[] = [];
    for (const l of this.levels()) {
      for (const v of l.classValues ?? []) {
        if (!seen.includes(v.label)) seen.push(v.label);
      }
    }
    return seen;
  });

  /** Spell-slot columns, in level order, only where the class has any. */
  protected readonly slotColumns = computed(() => {
    const seen = new Set<number>();
    for (const l of this.levels()) {
      for (const key of Object.keys(l.spellSlots ?? {})) seen.add(Number(key));
    }
    return [...seen].sort((a, b) => a - b);
  });

  protected readonly hasCantrips = computed(() =>
    this.levels().some(l => l.cantripsKnown != null),
  );

  protected readonly hasPrepared = computed(() =>
    this.levels().some(l => l.preparedSpells != null),
  );

  protected classValue(row: VocationLevelView, column: string): string {
    return (row.classValues ?? []).find(v => v.label === column)?.value ?? '—';
  }

  protected slot(row: VocationLevelView, level: number): string {
    const n = row.spellSlots?.[String(level)];
    return n == null ? '—' : String(n);
  }

  protected subclassName(f: FeatureView): string {
    const id = this.subclassIdOf(f);
    return this.subclasses().find(s => s.id === id)?.name ?? '';
  }

  private subclassIdOf(f: FeatureView): string | null {
    return f.subclassId ?? null;
  }
}
