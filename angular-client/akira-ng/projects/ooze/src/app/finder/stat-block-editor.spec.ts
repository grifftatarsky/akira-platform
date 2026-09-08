import { TestBed } from '@angular/core/testing';
import { StatBlockEditor } from './stat-block-editor';
import { StatBlockView } from './stat-block.models';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

/**
 * What the editor sends, not what it looks like.
 *
 * The panel merges `value()` into the save request, so this is the seam where a
 * control that reads correctly can still write the wrong thing — and the case
 * that matters is the one the mode exists for: three attacks split across two
 * weapons must not become three of each.
 */
describe('StatBlockEditor', () => {
  const aboleth = {
    id: 'sb-1',
    size: 'LARGE',
    creatureType: 'ABERRATION',
    creatureSubtype: null,
    alignment: null,
    armorClass: 17,
    armorClassNote: null,
    initiativeBonus: 7,
    hitPointsAverage: 150,
    hitPointsDice: '20d10 + 40',
    speeds: { WALK: 10, SWIM: 40 },
    canHover: false,
    abilityScores: { STRENGTH: 21 },
    saveBonuses: {},
    skills: {},
    senses: {},
    passivePerception: 20,
    damageResponses: [],
    conditionImmunities: [],
    languages: 'Deep Speech',
    telepathyFeet: 120,
    challengeRating: 10,
    experiencePoints: 5900,
    proficiencyBonus: 4,
    spellcastingAbility: null,
    spellSaveDc: null,
    spellAttackBonus: null,
    legendaryActionUses: 3,
    knownSpells: [
      { spellId: 'sp-1', spellName: 'Detect Magic', spellLevel: 1, baseLevel: 1,
        usesReset: 'AT_WILL', usesMax: null },
    ],
    features: [
      { id: 'f-tentacle', name: 'Tentacle', description: null, activation: 'ACTION',
        legendaryCost: null, triggerText: null, usesReset: 'AT_WILL', usesMax: null,
        rechargeMin: null, rechargeMax: null, areaShape: null, areaSizeFeet: null,
        steps: [], components: [] },
      { id: 'f-multi', name: 'Multiattack', description: 'Two Tentacle attacks.',
        activation: 'ACTION', legendaryCost: null, triggerText: null, usesReset: 'AT_WILL',
        usesMax: null, rechargeMin: null, rechargeMax: null, areaShape: null,
        areaSizeFeet: null, steps: [],
        components: [
          { id: 'c-1', referencedFeatureId: 'f-tentacle', referencedFeatureName: 'Tentacle',
            count: 2, optional: false, mode: 'FIXED', choiceGroup: null },
        ] },
    ],
  } as unknown as StatBlockView;

  function editorFor(block: StatBlockView | null): StatBlockEditor {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(StatBlockEditor);
    fixture.componentRef.setInput('statBlock', block);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('sends a Multiattack line back as it was loaded', () => {
    const value = editorFor(aboleth).value() as Record<string, any>;
    const multiattack = value['features'].find((f: any) => f.name === 'Multiattack');

    expect(multiattack.components).toHaveLength(1);
    expect(multiattack.components[0]).toMatchObject({
      referencedFeatureId: 'f-tentacle',
      count: 2,
      mode: 'FIXED',
    });
  });

  it('keeps the spells a creature can cast, which no control edits', () => {
    // Copy-on-write starts from an empty stat block, so a payload that left
    // these out would have a DM's edit forget what the creature casts.
    const value = editorFor(aboleth).value() as Record<string, any>;

    expect(value['knownSpells']).toEqual([
      { spellId: 'sp-1', spellLevel: 1, usesReset: 'AT_WILL', usesMax: null },
    ]);
  });

  it('drops a Multiattack line that points at nothing', () => {
    const editor = editorFor(aboleth);
    const multiattack = editor['features'].controls.find(
      f => f.get('name')!.value === 'Multiattack',
    )!;
    editor['componentsOf'](multiattack).at(0).patchValue({ referencedFeatureId: null });

    const value = editor.value() as Record<string, any>;
    const saved = value['features'].find((f: any) => f.name === 'Multiattack');
    // A component with no target is not a rule, and the mapper would drop it
    // server-side anyway; not sending it keeps the two ends agreeing.
    expect(saved.components).toHaveLength(0);
  });

  it('offers the block\'s other saved features as targets, and not itself', () => {
    const editor = editorFor(aboleth);
    const multiattack = editor['features'].controls.find(
      f => f.get('name')!.value === 'Multiattack',
    )!;

    expect(editor['targetsFor'](multiattack)).toEqual([
      { id: 'f-tentacle', name: 'Tentacle' },
    ]);
  });
});
