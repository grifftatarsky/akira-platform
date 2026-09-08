import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ContentService } from './content.service';
import { CatalogItem, titleCase } from './ooze-content.models';
import {
  ABILITIES, ACTIVATIONS, ALIGNMENTS, AREA_SHAPES, ATTACK_KINDS, CREATURE_TYPES,
  DAMAGE_RESPONSES, DAMAGE_TYPES, DELIVERIES, EFFECT_KINDS, EFFECT_OUTCOMES, MOVEMENT_TYPES,
  COMPONENT_MODES, SENSE_TYPES, SIZES, SKILLS, STEP_TRIGGERS, StatBlockView, USES_RESETS,
  parseDice,
} from './stat-block.models';

/**
 * A stat block editor, laid out the way the book prints one.
 *
 * <p>The generic label/value form the rest of the finder uses cannot express a
 * creature: speeds are a map, skills and senses are lists, and a feature is a
 * small tree with an action economy and its own effects. This owns that shape.
 *
 * <p>It does not save. The panel around it still owns the request, and reads
 * {@link value} when the user submits — one save path for every content type,
 * whatever the form looked like.
 */
@Component({
  selector: 'ooze-stat-block-editor',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stat-block-editor.html',
})
export class StatBlockEditor {
  private readonly fb = inject(FormBuilder);
  private readonly content = inject(ContentService);

  readonly statBlock = input<StatBlockView | null>(null);

  protected readonly sizes = SIZES;
  protected readonly creatureTypes = CREATURE_TYPES;
  protected readonly alignments = ALIGNMENTS;
  protected readonly abilities = ABILITIES;
  protected readonly skillNames = SKILLS;
  protected readonly movementTypes = MOVEMENT_TYPES;
  protected readonly senseTypes = SENSE_TYPES;
  protected readonly damageTypes = DAMAGE_TYPES;
  protected readonly damageResponses = DAMAGE_RESPONSES;
  protected readonly activations = ACTIVATIONS;
  protected readonly usesResets = USES_RESETS;
  protected readonly deliveries = DELIVERIES;
  protected readonly attackKinds = ATTACK_KINDS;
  protected readonly areaShapes = AREA_SHAPES;
  protected readonly effectOutcomes = EFFECT_OUTCOMES;
  protected readonly effectKinds = EFFECT_KINDS;
  protected readonly stepTriggers = STEP_TRIGGERS;
  protected readonly componentModes = COMPONENT_MODES;

  protected readonly label = titleCase;

  /** Conditions, for the immunity picker and for an effect that applies one. */
  protected readonly conditions = signal<readonly CatalogItem[]>([]);

  protected readonly form: FormGroup = this.fb.group({
    size: [null as string | null],
    creatureType: [null as string | null],
    creatureSubtype: [''],
    alignment: [null as string | null],
    armorClass: [null as number | null],
    armorClassNote: [''],
    initiativeBonus: [null as number | null],
    hitPointsAverage: [null as number | null],
    hitPointsDiceCount: [null as number | null],
    hitPointsDiceFaces: [null as number | null],
    hitPointsDiceBonus: [null as number | null],
    canHover: [false],
    speeds: this.fb.group(Object.fromEntries(MOVEMENT_TYPES.map(m => [m, [null as number | null]]))),
    strength: [null as number | null],
    dexterity: [null as number | null],
    constitution: [null as number | null],
    intelligence: [null as number | null],
    wisdom: [null as number | null],
    charisma: [null as number | null],
    saveBonuses: this.fb.group(Object.fromEntries(ABILITIES.map(a => [a, [null as number | null]]))),
    senses: this.fb.group(Object.fromEntries(SENSE_TYPES.map(s => [s, [null as number | null]]))),
    passivePerception: [null as number | null],
    languages: [''],
    telepathyFeet: [null as number | null],
    challengeRating: [null as number | null],
    experiencePoints: [null as number | null],
    proficiencyBonus: [null as number | null],
    spellcastingAbility: [null as string | null],
    spellSaveDc: [null as number | null],
    spellAttackBonus: [null as number | null],
    legendaryActionUses: [null as number | null],
    skills: this.fb.array([] as FormGroup[]),
    damageResponses: this.fb.array([] as FormGroup[]),
    conditionImmunityIds: this.fb.array([] as FormGroup[]),
    features: this.fb.array([] as FormGroup[]),
  });

  constructor() {
    // The condition immunity picker needs every condition at once, and the
    // rules define about fifteen — one page over the cap holds the lot.
    this.content.list('condition', { size: 200 }).subscribe({
      next: page => this.conditions.set(page.content),
      error: () => this.conditions.set([]),
    });
    // Repopulate whenever the panel hands over a different creature.
    effect(() => {
      const block = this.statBlock();
      untracked(() => this.populate(block));
    });
  }

  protected get skills(): FormArray<FormGroup> {
    return this.form.get('skills') as FormArray<FormGroup>;
  }

  protected get damageResponseRows(): FormArray<FormGroup> {
    return this.form.get('damageResponses') as FormArray<FormGroup>;
  }

  protected get features(): FormArray<FormGroup> {
    return this.form.get('features') as FormArray<FormGroup>;
  }

  protected stepsOf(feature: FormGroup): FormArray<FormGroup> {
    return feature.get('steps') as FormArray<FormGroup>;
  }

  protected effectsOf(step: FormGroup): FormArray<FormGroup> {
    return step.get('effects') as FormArray<FormGroup>;
  }

  protected componentsOf(feature: FormGroup): FormArray<FormGroup> {
    return feature.get('components') as FormArray<FormGroup>;
  }

  /**
   * The creature's other features, which are what a Multiattack can refer to.
   *
   * <p>A feature saved for the first time has no id yet, so it cannot be
   * pointed at until the creature has been saved once — the same limit the
   * request DTO documents, and the reason a new feature is offered greyed.
   */
  protected targetsFor(feature: FormGroup): { id: string; name: string }[] {
    return this.features.controls
      .filter(f => f !== feature && f.get('id')?.value && f.get('name')?.value)
      .map(f => ({ id: f.get('id')!.value as string, name: f.get('name')!.value as string }));
  }

  protected immunityIds = signal<readonly string[]>([]);

  protected toggleImmunity(id: string): void {
    const current = this.immunityIds();
    this.immunityIds.set(
      current.includes(id) ? current.filter(x => x !== id) : [...current, id],
    );
  }

  protected addSkill(): void {
    this.skills.push(this.fb.group({ skill: [SKILLS[0] as string], bonus: [0] }));
  }

  protected addDamageResponse(): void {
    this.damageResponseRows.push(
      this.fb.group({
        damageType: [DAMAGE_TYPES[0] as string],
        response: [DAMAGE_RESPONSES[0] as string],
        qualifier: [''],
      }),
    );
  }

  protected addFeature(): void {
    this.features.push(this.newFeature());
  }

  protected addStep(feature: FormGroup): void {
    const steps = this.stepsOf(feature);
    // A second step is a follow-up, so it defaults to firing on a hit — which is
    // what every chained feature in the book does.
    steps.push(this.newStep(steps.length ? 'ON_PREVIOUS_HIT' : 'ALWAYS'));
  }

  protected addEffect(step: FormGroup): void {
    this.effectsOf(step).push(this.newEffect());
  }

  /** One line of a Multiattack: "two Tentacle attacks". */
  protected addComponent(feature: FormGroup): void {
    const first = this.targetsFor(feature)[0];
    this.componentsOf(feature).push(
      this.fb.group({
        referencedFeatureId: [first?.id ?? null],
        count: [1],
        mode: ['FIXED'],
        choiceGroup: [null as number | null],
        optional: [false],
      }),
    );
  }

  protected removeAt(array: FormArray<FormGroup>, index: number): void {
    array.removeAt(index);
  }

  /** The body the panel merges into its save request. */
  value(): Record<string, unknown> {
    const v = this.form.getRawValue() as Record<string, any>;
    return {
      ...v,
      speeds: pruneZeros(v['speeds']),
      saveBonuses: pruneNulls(v['saveBonuses']),
      senses: pruneZeros(v['senses']),
      skills: Object.fromEntries(
        (v['skills'] as { skill: string; bonus: number }[]).map(s => [s.skill, s.bonus]),
      ),
      damageResponses: v['damageResponses'],
      conditionImmunityIds: this.immunityIds(),
      // Sent every time, not only when edited: the request is the whole stat
      // block, so leaving these out would detach a monster's spells on save.
      knownSpells: (this.statBlock()?.knownSpells ?? []).map(k => ({
        spellId: k.spellId,
        spellLevel: k.spellLevel,
        usesReset: k.usesReset,
        usesMax: k.usesMax,
      })),
      features: (v['features'] as Record<string, any>[]).map(f => ({
        ...f,
        components: (f['components'] as Record<string, any>[]).filter(
          c => c['referencedFeatureId'],
        ),
        steps: (f['steps'] as Record<string, any>[]).map(st => ({
          ...st,
          effects: (st['effects'] as Record<string, any>[]).map(e => ({
            ...e,
            conditionId: e['conditionId'] || null,
          })),
        })),
      })),
    };
  }

  private newFeature(): FormGroup {
    return this.fb.group({
      id: [null as string | null],
      name: [''],
      description: [''],
      activation: ['ACTION'],
      legendaryCost: [null as number | null],
      triggerText: [''],
      usesReset: ['AT_WILL'],
      usesMax: [null as number | null],
      rechargeMin: [null as number | null],
      rechargeMax: [null as number | null],
      areaShape: [null as string | null],
      areaSizeFeet: [null as number | null],
      steps: this.fb.array([] as FormGroup[]),
      components: this.fb.array([] as FormGroup[]),
    });
  }

  private newStep(trigger = 'ALWAYS'): FormGroup {
    return this.fb.group({
      id: [null as string | null],
      trigger: [trigger],
      targetFilter: [''],
      delivery: ['AUTOMATIC'],
      attackKind: [null as string | null],
      attackBonus: [null as number | null],
      reachFeet: [null as number | null],
      rangeFeet: [null as number | null],
      rangeLongFeet: [null as number | null],
      saveAbility: [null as string | null],
      saveDc: [null as number | null],
      effects: this.fb.array([] as FormGroup[]),
    });
  }

  private newEffect(): FormGroup {
    return this.fb.group({
      id: [null as string | null],
      outcome: ['ALWAYS'],
      kind: ['DAMAGE'],
      diceCount: [null as number | null],
      diceFaces: [null as number | null],
      diceBonus: [null as number | null],
      diceAverage: [null as number | null],
      damageType: [null as string | null],
      halfDamage: [false],
      conditionId: [null as string | null],
      escapeDc: [null as number | null],
      notes: [''],
    });
  }

  private populate(block: StatBlockView | null): void {
    this.skills.clear();
    this.damageResponseRows.clear();
    this.features.clear();
    if (!block) {
      this.form.reset({ canHover: false });
      this.immunityIds.set([]);
      return;
    }
    const hp = parseDice(block.hitPointsDice);
    this.form.patchValue({
      size: block.size,
      creatureType: block.creatureType,
      creatureSubtype: block.creatureSubtype ?? '',
      alignment: block.alignment,
      armorClass: block.armorClass,
      armorClassNote: block.armorClassNote ?? '',
      initiativeBonus: block.initiativeBonus,
      hitPointsAverage: block.hitPointsAverage,
      hitPointsDiceCount: hp.count,
      hitPointsDiceFaces: hp.faces,
      hitPointsDiceBonus: hp.bonus,
      canHover: block.canHover,
      speeds: fill(MOVEMENT_TYPES, block.speeds),
      strength: block.abilityScores?.['STRENGTH'] ?? null,
      dexterity: block.abilityScores?.['DEXTERITY'] ?? null,
      constitution: block.abilityScores?.['CONSTITUTION'] ?? null,
      intelligence: block.abilityScores?.['INTELLIGENCE'] ?? null,
      wisdom: block.abilityScores?.['WISDOM'] ?? null,
      charisma: block.abilityScores?.['CHARISMA'] ?? null,
      saveBonuses: fill(ABILITIES, block.saveBonuses),
      senses: fill(SENSE_TYPES, block.senses),
      passivePerception: block.passivePerception,
      languages: block.languages ?? '',
      telepathyFeet: block.telepathyFeet,
      challengeRating: block.challengeRating,
      experiencePoints: block.experiencePoints,
      proficiencyBonus: block.proficiencyBonus,
      spellcastingAbility: block.spellcastingAbility,
      spellSaveDc: block.spellSaveDc,
      spellAttackBonus: block.spellAttackBonus,
      legendaryActionUses: block.legendaryActionUses,
    });
    for (const [skill, bonus] of Object.entries(block.skills ?? {})) {
      this.skills.push(this.fb.group({ skill: [skill], bonus: [bonus] }));
    }
    // The response renders these as "IMMUNITY FIRE"; split them back apart.
    for (const line of block.damageResponses ?? []) {
      const [response, damageType, ...rest] = line.split(' ');
      this.damageResponseRows.push(
        this.fb.group({
          damageType: [damageType],
          response: [response],
          qualifier: [rest.join(' ').replace(/^\(|\)$/g, '')],
        }),
      );
    }
    this.immunityIds.set(
      this.conditions()
        .filter(c => (block.conditionImmunities ?? []).includes(c.name))
        .map(c => c.id),
    );
    for (const f of block.features ?? []) {
      const group = this.newFeature();
      group.patchValue({
        id: f.id,
        name: f.name,
        description: f.description ?? '',
        activation: f.activation,
        legendaryCost: f.legendaryCost,
        triggerText: f.triggerText ?? '',
        usesReset: f.usesReset,
        usesMax: f.usesMax,
        rechargeMin: f.rechargeMin,
        rechargeMax: f.rechargeMax,
        areaShape: f.areaShape,
        areaSizeFeet: f.areaSizeFeet,
      });
      const components = group.get('components') as FormArray<FormGroup>;
      for (const c of f.components ?? []) {
        components.push(
          this.fb.group({
            referencedFeatureId: [c.referencedFeatureId],
            count: [c.count],
            mode: [c.mode],
            choiceGroup: [c.choiceGroup],
            optional: [c.optional],
          }),
        );
      }
      const steps = group.get('steps') as FormArray<FormGroup>;
      for (const st of f.steps ?? []) {
        const sg = this.newStep();
        sg.patchValue({
          id: st.id,
          trigger: st.trigger,
          targetFilter: st.targetFilter ?? '',
          delivery: st.delivery,
          attackKind: st.attackKind,
          attackBonus: st.attackBonus,
          reachFeet: st.reachFeet,
          rangeFeet: st.rangeFeet,
          rangeLongFeet: st.rangeLongFeet,
          saveAbility: st.saveAbility,
          saveDc: st.saveDc,
        });
        const effects = sg.get('effects') as FormArray<FormGroup>;
        for (const e of st.effects ?? []) {
          const dice = parseDice(e.amount);
          const eg = this.newEffect();
          eg.patchValue({
            id: e.id,
            outcome: e.outcome,
            kind: e.kind,
            diceCount: dice.count,
            diceFaces: dice.faces,
            diceBonus: dice.bonus,
            diceAverage: e.average,
            damageType: e.damageType,
            halfDamage: e.halfDamage,
            conditionId: e.conditionId,
            escapeDc: e.escapeDc,
            notes: e.notes ?? '',
          });
          effects.push(eg);
        }
        steps.push(sg);
      }
      this.features.push(group);
    }
  }
}

/** Builds a full map so every key has a control, absent ones as null. */
function fill(keys: readonly string[], source: Record<string, number> | undefined) {
  return Object.fromEntries(keys.map(k => [k, source?.[k] ?? null]));
}

/** A speed or sense of 0 means "hasn't got one", so it isn't sent. */
function pruneZeros(map: Record<string, number | null>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(map).filter(([, v]) => v != null && v > 0),
  ) as Record<string, number>;
}

function pruneNulls(map: Record<string, number | null>): Record<string, number> {
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v != null)) as Record<string, number>;
}
