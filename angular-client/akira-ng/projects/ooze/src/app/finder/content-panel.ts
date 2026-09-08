import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { CatalogItem, ContentTypeDef, FieldDef, titleCase } from './ooze-content.models';
import { ContentService } from './content.service';
import { ClassDetail } from './class-detail';
import { ItemEditor } from './item-editor';
import { StatBlockEditor } from './stat-block-editor';
import {
  FeatureStepView,
  FeatureView,
  StatBlockView,
  multiattackLine,
} from './stat-block.models';

/**
 * Generic detail + editor for any catalog item, rendered from its
 * {@link ContentTypeDef}. Read-only for everyone; edit/create/revert/hide/delete
 * show only for a signed-in DM. Editing a base row copy-on-writes server-side,
 * hence the up-front notice. Emits {@link changed} with the id to re-select
 * (or null) after a successful write.
 */
@Component({
  selector: 'ooze-content-panel',
  imports: [ReactiveFormsModule, ClassDetail, ItemEditor, StatBlockEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './content-panel.html',
})
export class ContentPanel {
  private readonly content = inject(ContentService);

  readonly def = input.required<ContentTypeDef>();
  readonly item = input<CatalogItem | null>(null);
  readonly creating = input(false);
  readonly canEdit = input(false);

  readonly changed = output<string | null>();
  readonly closeCreate = output<void>();

  /**
   * Content types whose mechanics are a tree rather than a row, and so bring
   * their own editor instead of the generic label/value form.
   */
  protected readonly usesStatBlock = computed(() => this.def().key === 'bestiary');

  /**
   * Items bring one too, but alongside the generic form rather than instead of
   * it: a name, a price and a rarity are ordinary fields, while the weapon and
   * armor rows are not.
   */
  protected readonly usesItemDetail = computed(() => this.def().key === 'items');

  /**
   * A class is a twenty-row table and two dozen features, which the label/value
   * grid can't show — so it brings its own read-only view beside the form.
   */
  protected readonly usesClassDetail = computed(() => this.def().key === 'classes');

  /** The category the form currently holds, so the editor shows the right block. */
  protected readonly editedCategory = signal('');

  protected readonly statBlock = computed<StatBlockView | null>(
    () => (this.item()?.['statBlock'] as StatBlockView | undefined) ?? null,
  );

  protected readonly features = computed<readonly FeatureView[]>(
    () => this.statBlock()?.features ?? [],
  );

  private readonly blockEditor = viewChild(StatBlockEditor);
  private readonly itemEditor = viewChild(ItemEditor);

  protected readonly form = signal<FormGroup>(new FormGroup({}));
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Rebuild the form when the content type changes.
    effect(() => {
      const def = this.def();
      this.form.set(this.buildForm(def));
      untracked(() => this.sync());
    });
    // Repopulate when the selected item / create-mode changes.
    effect(() => {
      this.item();
      this.creating();
      this.sync();
    });
  }

  /** Meta fields for the read-only detail grid — includes list fields. */
  protected metaFields(): readonly FieldDef[] {
    return this.def().fields.filter(f => f.group === 'meta' && f.kind !== 'boolean');
  }

  /**
   * Meta fields the generic form can edit. List and derived fields are
   * excluded: a set of abilities needs a multi-select and a weapon's damage
   * needs four inputs, and rendering either as a text box would let a save
   * silently flatten it.
   */
  protected metaInputs(): readonly FieldDef[] {
    return this.def().fields.filter(
      f => f.group === 'meta' && f.kind !== 'boolean' && f.kind !== 'list' && !f.value,
    );
  }

  protected metaBooleans(): readonly FieldDef[] {
    return this.def().fields.filter(f => f.group === 'meta' && f.kind === 'boolean');
  }

  protected proseFields(): readonly FieldDef[] {
    return this.def().fields.filter(f => f.group === 'prose');
  }

  protected startEdit(): void {
    this.populate(this.item());
    this.error.set(null);
    this.editing.set(true);
  }

  protected cancel(): void {
    this.error.set(null);
    if (this.creating()) this.closeCreate.emit();
    else this.editing.set(false);
  }

  protected save(): void {
    const form = this.form();
    if (form.invalid || this.saving()) {
      form.markAllAsTouched();
      return;
    }
    const body = form.getRawValue() as Record<string, unknown>;
    // The stat block editor owns its own form; the panel still owns the save,
    // so there is one request path whatever the fields looked like.
    const editor = this.blockEditor();
    if (editor) {
      body['statBlock'] = editor.value();
    }
    const item = this.itemEditor();
    if (item) {
      Object.assign(body, item.value());
    }
    const path = this.def().apiPath;
    const current = this.item();
    const call =
      this.creating() || !current
        ? this.content.create(path, body)
        : this.content.update(path, current.id, body);
    this.saving.set(true);
    this.error.set(null);
    call.subscribe({
      next: saved => {
        this.saving.set(false);
        this.editing.set(false);
        this.changed.emit(saved.id);
      },
      error: () => {
        this.saving.set(false);
        this.error.set('Could not save. Check the fields and try again.');
      },
    });
  }

  protected revert(): void {
    const it = this.item();
    if (!it?.overridesId) return;
    this.saving.set(true);
    this.content.revert(this.def().apiPath, it.overridesId).subscribe({
      next: base => {
        this.saving.set(false);
        this.changed.emit(base.id);
      },
      error: () => {
        this.saving.set(false);
        this.error.set('Could not revert.');
      },
    });
  }

  protected hide(): void {
    const it = this.item();
    if (!it) return;
    this.saving.set(true);
    this.content.hide(this.def().apiPath, it.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.changed.emit(null);
      },
      error: () => {
        this.saving.set(false);
        this.error.set('Could not hide.');
      },
    });
  }

  protected remove(): void {
    const it = this.item();
    if (!it) return;
    this.saving.set(true);
    this.content.remove(this.def().apiPath, it.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.changed.emit(null);
      },
      error: () => {
        this.saving.set(false);
        this.error.set('Could not delete.');
      },
    });
  }

  protected subtitle(item: CatalogItem): string {
    const d = this.def();
    return d.subtitle ? d.subtitle(item) : '';
  }

  protected hasValue(item: CatalogItem, f: FieldDef): boolean {
    if (f.value) return f.value(item).trim() !== '';
    const v = item[f.key];
    if (Array.isArray(v)) return v.length > 0;
    return v !== null && v !== undefined && String(v).trim() !== '';
  }

  protected display(item: CatalogItem, f: FieldDef): string {
    if (f.value) return f.value(item);
    const v = item[f.key];
    if (Array.isArray(v)) return v.map(x => titleCase(String(x))).join(', ');
    if (f.kind === 'select' && f.options) {
      const opt = f.options.find(o => String(o.value) === String(v));
      if (opt) return opt.label;
    }
    return v == null ? '' : String(v);
  }

  protected activationLabel(f: FeatureView): string {
    return titleCase(f.activation);
  }

  /**
   * The stat line a stat block prints under a feature's name — "Melee Attack
   * Roll: +9, reach 15 ft. Hit: 2d6 + 5 Bludgeoning" — reassembled from the
   * structured fields, so it reads as the book does and proves the numbers made
   * it through the import.
   */
  protected attackLine(f: FeatureView): string {
    return (f.steps ?? []).map(stepLine).filter(Boolean).join(' \u2192 ');
  }

  /**
   * A Multiattack's plan, from its components rather than its sentence — the
   * quickest way to see that a choice didn't import as one-of-each.
   */
  protected planLine(f: FeatureView): string {
    return multiattackLine(f.components ?? []);
  }

  protected booleanChips(item: CatalogItem): string[] {
    return this.def()
      .fields.filter(f => f.kind === 'boolean' && item[f.key] === true)
      .map(f => f.label);
  }

  /**
   * Which weapon/armor block the item editor shows follows the category field —
   * and only that one, so changing a rarity doesn't hide a weapon's damage.
   */
  protected onSelectChange(key: string, value: string): void {
    if (key === 'itemCategory') {
      this.editedCategory.set(value);
    }
  }

  private buildForm(def: ContentTypeDef): FormGroup {
    const controls: Record<string, FormControl> = {
      name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    };
    for (const f of def.fields) {
      if (f.value) continue; // derived: display-only, no control to bind
      const validators: ValidatorFn[] = [];
      if (f.required) validators.push(Validators.required);
      if (f.kind === 'number') {
        if (f.min != null) validators.push(Validators.min(f.min));
        if (f.max != null) validators.push(Validators.max(f.max));
      }
      controls[f.key] = new FormControl(this.initial(f), {
        nonNullable: f.kind === 'boolean',
        validators,
      });
    }
    return new FormGroup(controls);
  }

  private initial(f: FieldDef): unknown {
    if (f.kind === 'boolean') return false;
    if (f.kind === 'number') return null;
    if (f.kind === 'select') return f.required && f.options?.length ? f.options[0].value : '';
    return '';
  }

  private sync(): void {
    this.error.set(null);
    if (this.creating()) {
      this.populate(null);
      this.editing.set(true);
    } else {
      this.populate(this.item());
      this.editing.set(false);
    }
  }

  private populate(item: CatalogItem | null): void {
    const form = this.form();
    form.get('name')?.setValue(item?.name ?? '');
    for (const f of this.def().fields) {
      const ctrl = form.get(f.key);
      if (!ctrl) continue;
      const v = item ? item[f.key] : undefined;
      ctrl.setValue(v ?? this.initial(f));
    }
    this.editedCategory.set(String(form.get('itemCategory')?.value ?? ''));
  }
}

/**
 * One resolution step written the way the book writes it — "Melee Attack Roll:
 * +9, reach 15 ft. Hit: 2d6 + 5 Bludgeoning damage" — reassembled from the
 * structured fields. A chained feature renders both, which is the quickest way
 * to see that the second roll survived an import.
 */
function stepLine(s: FeatureStepView): string {
  const parts: string[] = [];
  if (s.delivery === 'ATTACK_ROLL' && s.attackBonus != null) {
    const kind = s.attackKind
      ? titleCase(s.attackKind).replace('Melee Or Ranged', 'Melee or Ranged')
      : 'Attack';
    const where = [
      s.reachFeet ? `reach ${s.reachFeet} ft.` : '',
      s.rangeFeet ? `range ${s.rangeFeet}${s.rangeLongFeet ? '/' + s.rangeLongFeet : ''} ft.` : '',
    ].filter(Boolean);
    parts.push(`${kind} Attack Roll: +${s.attackBonus}${where.length ? ', ' + where.join(' or ') : ''}`);
  } else if (s.delivery === 'SAVING_THROW' && s.saveAbility) {
    parts.push(`${titleCase(s.saveAbility)} Saving Throw: DC ${s.saveDc ?? '\u2014'}`);
  }
  const damage = (s.effects ?? [])
    .filter(e => e.kind === 'DAMAGE' && e.amount)
    .map(e => `${e.amount}${e.damageType ? ' ' + titleCase(e.damageType) : ''}`)
    .join(' plus ');
  if (damage) {
    parts.push(`${s.delivery === 'ATTACK_ROLL' ? 'Hit' : 'Failure'}: ${damage} damage`);
  }
  const conditions = (s.effects ?? [])
    .filter(e => e.kind === 'APPLY_CONDITION' && e.conditionName)
    .map(e => e.conditionName + (e.escapeDc ? ` (escape DC ${e.escapeDc})` : ''));
  if (conditions.length) parts.push(conditions.join(', '));
  // "reach 15 ft." already ends the clause; joining on ". " would double it.
  return parts.map(p => (p.endsWith('.') ? p.slice(0, -1) : p)).join('. ');
}
