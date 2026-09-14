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

  function fixtureFor(block: StatBlockView | null) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(StatBlockEditor);
    fixture.componentRef.setInput('statBlock', block);
    fixture.detectChanges();
    return fixture;
  }

  function editorFor(block: StatBlockView | null): StatBlockEditor {
    return fixtureFor(block).componentInstance;
  }

  /**
   * The markup a named feature renders into. Found by walking up from its name
   * input rather than by class or nesting depth, so restyling the panel doesn't
   * quietly turn these into tests of nothing.
   */
  function blockFor(el: HTMLElement, feature: string): HTMLElement {
    const name = [...el.querySelectorAll('input[type=text]')].find(
      i => (i as HTMLInputElement).value === feature,
    )!;
    let node = name.parentElement!;
    while (!node.querySelector('[formarrayname=components]')) node = node.parentElement!;
    return node;
  }

  /** Its Multiattack rows: the ones carrying the target and mode selects. */
  function linesUnder(el: HTMLElement, feature: string): HTMLElement[] {
    const rows = blockFor(el, feature).querySelector('[formarrayname=components]')!.children;
    return [...rows].filter(k => k.querySelector('select')) as HTMLElement[];
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

  // Everything above asserts on the payload, which a control that never renders
  // would still produce — it sends back whatever was loaded. These mount it.
  describe('the rendered Multiattack rows', () => {
    it('draws a loaded line with its target selected', () => {
      const el: HTMLElement = fixtureFor(aboleth).nativeElement;
      const rows = linesUnder(el, 'Multiattack');
      expect(rows).toHaveLength(1);

      const [count, group] = [...rows[0].querySelectorAll('input[type=number]')] as HTMLInputElement[];
      const [target, mode] = [...rows[0].querySelectorAll('select')] as HTMLSelectElement[];

      expect(count.value).toBe('2');
      expect(target.selectedOptions[0].textContent!.trim()).toBe('Tentacle');
      expect(mode.selectedOptions[0].textContent!.trim()).toBe('Always');
      expect(group.value).toBe('');
      expect(rows[0].querySelector('input[type=checkbox]')).not.toBeNull();
    });

    it('lists only the other saved actions in the target select', () => {
      const el: HTMLElement = fixtureFor(aboleth).nativeElement;
      const target = linesUnder(el, 'Multiattack')[0].querySelector('select')!;

      expect([...target.options].map(o => o.textContent!.trim())).toEqual(['Tentacle']);
    });

    it('disables Add line on a creature with nothing to point at, and says why', () => {
      const el: HTMLElement = fixtureFor(null).nativeElement;
      const add = [...el.querySelectorAll('button')].find(b => b.textContent!.includes('Add line'));

      // A brand new block has no features at all, so there is no row to add to;
      // if one ever renders, the button must be off rather than offer an empty list.
      if (add) {
        expect((add as HTMLButtonElement).disabled).toBe(true);
        expect(el.textContent).toContain('save the creature once first');
      } else {
        expect(el.querySelectorAll('[formarrayname=components]')).toHaveLength(0);
      }
    });

    it('renders a new row when Add line is clicked', () => {
      const fixture = fixtureFor(aboleth);
      const el: HTMLElement = fixture.nativeElement;
      const add = [...blockFor(el, 'Multiattack').querySelectorAll('button')]
        .find(b => b.textContent!.includes('Add line')) as HTMLButtonElement;

      expect(add.disabled).toBe(false);
      add.click();
      fixture.detectChanges();

      expect(linesUnder(el, 'Multiattack')).toHaveLength(2);
    });

    it('carries a mode picked in the select through to the payload', () => {
      // The case the mode exists for: three attacks split across two weapons is
      // two CHOICE lines in one group, not three of each.
      const fixture = fixtureFor(aboleth);
      const el: HTMLElement = fixture.nativeElement;
      const row = linesUnder(el, 'Multiattack')[0];
      const mode = row.querySelectorAll('select')[1] as HTMLSelectElement;
      const group = row.querySelectorAll('input[type=number]')[1] as HTMLInputElement;

      mode.selectedIndex = [...mode.options]
        .findIndex(o => o.textContent!.trim() === 'Any combination');
      mode.dispatchEvent(new Event('change'));
      group.value = '0';
      group.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const value = fixture.componentInstance.value() as Record<string, any>;
      const saved = value['features'].find((f: any) => f.name === 'Multiattack');
      expect(saved.components[0]).toMatchObject({ mode: 'CHOICE', choiceGroup: 0 });
    });

    it('removes a row from the DOM and from the payload', () => {
      const fixture = fixtureFor(aboleth);
      const el: HTMLElement = fixture.nativeElement;
      const remove = linesUnder(el, 'Multiattack')[0]
        .querySelector('button[aria-label="Remove line"]') as HTMLButtonElement;

      remove.click();
      fixture.detectChanges();

      expect(linesUnder(el, 'Multiattack')).toHaveLength(0);
      const value = fixture.componentInstance.value() as Record<string, any>;
      expect(value['features'].find((f: any) => f.name === 'Multiattack').components)
        .toHaveLength(0);
    });
  });
});
