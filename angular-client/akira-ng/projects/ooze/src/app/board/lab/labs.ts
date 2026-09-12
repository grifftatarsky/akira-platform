export interface Criterion {
  readonly working: string;
  readonly notHelping: string;
  readonly broken: string;
}

export interface LabEntry {
  readonly id: string;
  readonly title: string;
  readonly phase: string;
  readonly standard: string;
  readonly scene: string;
  readonly criterion: Criterion;
  readonly result: string | null;
}

export const LABS: readonly LabEntry[] = [
  {
    id: 'translucency',
    title: 'Subsurface translucency on the sward',
    phase: '2.3',
    standard: 'Every shipping grass renderer transmits light through the blade; '
      + 'Ghost of Tsushima and Horizon both do. The question here is not whether '
      + 'the effect is real but whether Babylon\'s PBR subsurface block is adding '
      + 'it or subtracting it: pbrBlockFinalLitComponents multiplies diffuse '
      + 'irradiance by (1 - translucencyIntensity) before adding the transmitted '
      + 'term, so at 0.55 the sward is throwing away over half its ambient to buy '
      + 'back a thickness-scaled version of it.',
    scene: 'A flat 60 x 60 foot patch of the real sward under the board\'s own '
      + 'sun, sky and post chain. Nothing else.',
    criterion: {
      working: 'On is not darker than off, and low blades carry light coming '
        + 'through them from the far side rather than only reflected off the near side.',
      notHelping: 'Off is indistinguishable from on — a change under the control '
        + 'diff means the switch is doing nothing visible.',
      broken: 'On is flatly darker everywhere, which is the irradiance being '
        + 'deleted and not replaced.',
    },
    result: '2026-09-12 — refused. 10.2 ms on / 9.7 ms off, so it costs 0.4 ms; and on is flatly darker and less saturated across the whole patch, which is the Broken criterion, not the Working one. Change 8.4 against a control of 0.5, so the switch is real. Babylon subtracts (1 - intensity) of diffuse irradiance before adding the transmitted term, and at 0.55 the sward is not getting it back.',
  },
];

export function labFor(id: string | null): LabEntry | undefined {
  return LABS.find(lab => lab.id === id);
}
