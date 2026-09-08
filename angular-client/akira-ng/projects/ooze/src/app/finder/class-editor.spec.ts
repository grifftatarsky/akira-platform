import { TestBed } from '@angular/core/testing';
import { ClassEditor } from './class-editor';
import { CatalogItem } from './ooze-content.models';

/**
 * What the editor sends, not what it looks like.
 *
 * The level table is the part that can be wrong quietly: the class's own
 * columns are data rather than a schema, so a grid that loses their order or
 * sends an empty cell as a value corrupts a class without failing anything.
 */
describe('ClassEditor', () => {
  const barbarian = {
    id: 'v-1',
    name: 'Barbarian',
    subclasses: [{ id: 'sc-1', name: 'Path of the Berserker', description: null }],
    levels: [
      { level: 1, proficiencyBonus: 2, featureSummary: 'Rage, Unarmored Defense',
        cantripsKnown: null, preparedSpells: null, spellSlots: {},
        classValues: [
          { label: 'Rages', value: '2' },
          { label: 'Rage Damage', value: '+2' },
          { label: 'Weapon Mastery', value: '2' },
        ] },
      { level: 2, proficiencyBonus: 2, featureSummary: 'Danger Sense',
        cantripsKnown: null, preparedSpells: null, spellSlots: {},
        classValues: [
          { label: 'Rages', value: '2' },
          { label: 'Rage Damage', value: '+2' },
          { label: 'Weapon Mastery', value: '2' },
        ] },
    ],
    features: [
      { id: 'f-1', name: 'Rage', description: 'You rage.', vocationLevel: 1,
        subclassId: null, activation: 'BONUS_ACTION', usesReset: 'LONG_REST', steps: [],
        components: [] },
      { id: 'f-2', name: 'Frenzy', description: 'You frenzy.', vocationLevel: 3,
        subclassId: 'sc-1', activation: 'PASSIVE', usesReset: 'AT_WILL', steps: [],
        components: [] },
    ],
  } as unknown as CatalogItem;

  function editorFor(item: CatalogItem | null): ClassEditor {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ClassEditor);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('always sends twenty rows, filling in the ones the class did not carry', () => {
    const value = editorFor(barbarian).value() as Record<string, any>;

    // A class table has twenty rows whether or not the data did; the mapper
    // matches on the level number, so the rows have to be there to match.
    expect(value['levels']).toHaveLength(20);
    expect(value['levels'][0].level).toBe(1);
    expect(value['levels'][19].level).toBe(20);
  });

  it('keeps the class columns in the book order', () => {
    const value = editorFor(barbarian).value() as Record<string, any>;

    expect(value['levels'][0].classValues).toEqual([
      { label: 'Rages', value: '2' },
      { label: 'Rage Damage', value: '+2' },
      { label: 'Weapon Mastery', value: '2' },
    ]);
  });

  it('sends nothing for a cell left blank', () => {
    const editor = editorFor(barbarian);
    const value = editor.value() as Record<string, any>;

    // Level 3 was never in the data, so its cells are empty — the book prints a
    // dash there, and an empty string is not a value.
    expect(value['levels'][2].classValues).toEqual([]);
    expect(value['levels'][2].featureSummary).toBeNull();
  });

  it('adds a column across every row at once', () => {
    const editor = editorFor(barbarian);
    editor['newColumn'].set('Brutal Strike');
    editor['addColumn']();

    const value = editor.value() as Record<string, any>;
    editor['valuesOf'](editor['levelRows'].at(0)).at(3).setValue('1 die');

    const after = editor.value() as Record<string, any>;
    expect(value['levels'][0].classValues.map((c: any) => c.label)).not.toContain('Brutal Strike');
    expect(after['levels'][0].classValues.at(-1)).toEqual({
      label: 'Brutal Strike',
      value: '1 die',
    });
  });

  it('keeps a feature id, its level and the subclass that grants it', () => {
    const value = editorFor(barbarian).value() as Record<string, any>;

    expect(value['features']).toHaveLength(2);
    expect(value['features'][0]).toMatchObject({
      id: 'f-1',
      name: 'Rage',
      vocationLevel: 1,
      subclassId: null,
      activation: 'BONUS_ACTION',
    });
    expect(value['features'][1]).toMatchObject({ id: 'f-2', subclassId: 'sc-1' });
  });

  it('sends a new feature with no id, so the server makes one', () => {
    const editor = editorFor(barbarian);
    editor['addFeature']();
    editor['features'].at(2).patchValue({ name: 'Second Breath', vocationLevel: 4 });

    const value = editor.value() as Record<string, any>;
    expect(value['features'][2]).toMatchObject({
      id: null,
      name: 'Second Breath',
      vocationLevel: 4,
    });
  });

  it('drops a spell slot count of zero, which is the book\'s dash', () => {
    const caster = {
      ...(barbarian as unknown as Record<string, unknown>),
      levels: [
        { level: 1, proficiencyBonus: 2, featureSummary: 'Spellcasting', cantripsKnown: 3,
          preparedSpells: 4, spellSlots: { 1: 2 }, classValues: [] },
      ],
    } as unknown as CatalogItem;
    const editor = editorFor(caster);
    const value = editor.value() as Record<string, any>;

    expect(value['levels'][0].spellSlots).toEqual({ 1: 2 });
    // Level 2 has the column but no slots yet.
    expect(value['levels'][1].spellSlots).toEqual({});
  });
});
