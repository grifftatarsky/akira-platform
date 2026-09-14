import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CatalogItem, titleCase } from './ooze-content.models';
import { SubclassView, VocationLevelView } from './class-detail';
import { ACTIVATIONS, FeatureView, USES_RESETS } from './stat-block.models';

/** The twenty rows a class table always has. */
const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * A class's level table and its features.
 *
 * The generic label/value form covers the header — hit die, saves, skills — and
 * cannot express the rest: twenty rows whose columns differ per class, because
 * a Barbarian's table has Rages where a Rogue's has Sneak Attack. Those columns
 * are data, not a schema, so the grid is built from whatever the class carries
 * and a DM can add one.
 *
 * It does not save. The panel around it reads {@link value} on submit, so there
 * is one request path for every content type.
 */
@Component({
  selector: 'ooze-class-editor',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './class-editor.html',
})
export class ClassEditor {
  private readonly fb = inject(FormBuilder);

  readonly item = input<CatalogItem | null>(null);

  protected readonly levels = LEVELS;
  protected readonly activations = ACTIVATIONS;
  protected readonly usesResets = USES_RESETS;
  protected readonly label = titleCase;

  /** The class's own columns — Rages, Sneak Attack — in the book's order. */
  protected readonly columns = signal<readonly string[]>([]);
  /** Which spell levels the table has slots for, if any. */
  protected readonly slotLevels = signal<readonly number[]>([]);
  protected readonly subclasses = signal<readonly SubclassView[]>([]);
  protected readonly newColumn = signal('');

  protected readonly form: FormGroup = this.fb.group({
    levels: this.fb.array([] as FormGroup[]),
    features: this.fb.array([] as FormGroup[]),
  });

  constructor() {
    effect(() => {
      const item = this.item();
      untracked(() => this.populate(item));
    });
  }

  protected get levelRows(): FormArray<FormGroup> {
    return this.form.get('levels') as FormArray<FormGroup>;
  }

  protected get features(): FormArray<FormGroup> {
    return this.form.get('features') as FormArray<FormGroup>;
  }

  protected valuesOf(row: FormGroup): FormArray {
    return row.get('values') as FormArray;
  }

  protected slotsOf(row: FormGroup): FormGroup {
    return row.get('slots') as FormGroup;
  }

  /** What the panel merges into its save request. */
  value(): Record<string, unknown> {
    const columns = this.columns();
    const slotLevels = this.slotLevels();
    const rows = this.levelRows.controls.map((row, i) => {
      const v = row.getRawValue() as Record<string, any>;
      const slots: Record<number, number> = {};
      for (const level of slotLevels) {
        const n = Number(v['slots'][`s${level}`]);
        if (n > 0) slots[level] = n;
      }
      return {
        level: i + 1,
        proficiencyBonus: Number(v['proficiencyBonus']) || 0,
        featureSummary: v['featureSummary'] || null,
        cantripsKnown: v['cantripsKnown'],
        preparedSpells: v['preparedSpells'],
        spellSlots: slots,
        // A column with nothing in it at this level is a dash in the book, and
        // the mapper drops it — sending it would store an empty string.
        classValues: columns
          .map((labelName, k) => ({ label: labelName, value: v['values'][k] }))
          .filter(c => c.value != null && String(c.value).trim() !== ''),
      };
    });

    return {
      levels: rows,
      features: this.features.controls.map(f => {
        const v = f.getRawValue() as Record<string, any>;
        return { ...v, subclassId: v['subclassId'] || null };
      }),
    };
  }

  protected addColumn(): void {
    const name = this.newColumn().trim();
    if (!name || this.columns().includes(name)) return;
    this.columns.update(c => [...c, name]);
    for (const row of this.levelRows.controls) {
      this.valuesOf(row).push(this.fb.control(''));
    }
    this.newColumn.set('');
  }

  protected removeColumn(index: number): void {
    this.columns.update(c => c.filter((_, i) => i !== index));
    for (const row of this.levelRows.controls) {
      this.valuesOf(row).removeAt(index);
    }
  }

  /** Spell slots are added a level at a time, the way a caster gains them. */
  protected addSlotLevel(): void {
    const next = (this.slotLevels().at(-1) ?? 0) + 1;
    if (next > 9) return;
    this.slotLevels.update(s => [...s, next]);
    for (const row of this.levelRows.controls) {
      this.slotsOf(row).addControl(`s${next}`, this.fb.control(null));
    }
  }

  protected removeSlotLevel(): void {
    const last = this.slotLevels().at(-1);
    if (last == null) return;
    this.slotLevels.update(s => s.slice(0, -1));
    for (const row of this.levelRows.controls) {
      this.slotsOf(row).removeControl(`s${last}`);
    }
  }

  protected addFeature(): void {
    this.features.push(this.newFeature());
  }

  protected removeFeature(index: number): void {
    this.features.removeAt(index);
  }

  private newFeature(): FormGroup {
    return this.fb.group({
      id: [null as string | null],
      name: [''],
      description: [''],
      vocationLevel: [1 as number | null],
      subclassId: [null as string | null],
      activation: ['PASSIVE'],
      usesReset: ['AT_WILL'],
    });
  }

  private populate(item: CatalogItem | null): void {
    const rows = (item?.['levels'] ?? []) as VocationLevelView[];
    const features = (item?.['features'] ?? []) as FeatureView[];
    this.subclasses.set((item?.['subclasses'] ?? []) as SubclassView[]);

    const columns: string[] = [];
    const slots = new Set<number>();
    for (const row of rows) {
      for (const v of row.classValues ?? []) {
        if (!columns.includes(v.label)) columns.push(v.label);
      }
      for (const key of Object.keys(row.spellSlots ?? {})) slots.add(Number(key));
    }
    this.columns.set(columns);
    this.slotLevels.set([...slots].sort((a, b) => a - b));

    this.levelRows.clear();
    for (const level of LEVELS) {
      const row = rows.find(r => r.level === level);
      const slotControls: Record<string, unknown> = {};
      for (const s of this.slotLevels()) slotControls[`s${s}`] = [row?.spellSlots?.[s] ?? null];
      this.levelRows.push(
        this.fb.group({
          proficiencyBonus: [row?.proficiencyBonus ?? Math.floor((level - 1) / 4) + 2],
          featureSummary: [row?.featureSummary ?? ''],
          cantripsKnown: [row?.cantripsKnown ?? null],
          preparedSpells: [row?.preparedSpells ?? null],
          slots: this.fb.group(slotControls),
          values: this.fb.array(
            columns.map(c => this.fb.control(
              (row?.classValues ?? []).find(v => v.label === c)?.value ?? '')),
          ),
        }),
      );
    }

    this.features.clear();
    for (const f of features) {
      const group = this.newFeature();
      group.patchValue({
        id: f.id,
        name: f.name,
        description: f.description ?? '',
        vocationLevel: f.vocationLevel ?? null,
        subclassId: f.subclassId ?? null,
        activation: f.activation,
        usesReset: f.usesReset,
      });
      this.features.push(group);
    }
  }
}
