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
    id: 'blade',
    title: 'A Bezier blade against the scanned card',
    phase: '1.1',
    standard: 'Every grass renderer that draws blades rather than photographs of '
      + 'them builds this shape. Jahrmann and Wimmer 2017 describe a blade as '
      + 'three control points of a quadratic Bezier plus height, width, direction '
      + 'and stiffness — "a blade of grass can be completely described by four 4D '
      + 'vectors" — tapering to a single tip vertex, with the edge normals rotated '
      + 'about the blade\'s own axis so a flat strip shades like a cylinder. The '
      + 'board\'s cards already fan their edge normals, but by atan(0.3) — a third '
      + 'of the 0.3 pi the reference uses.',
    scene: 'A flat 60 x 60 foot patch under the board\'s own sun, sky and post '
      + 'chain. Three sowings on the same field with the same seeds, so every '
      + 'plant stands in the same place in all three and only its geometry '
      + 'differs: the card as it ships, the same card with the reference twist on '
      + 'its edge normals, and three Bezier blades standing in for each scanned '
      + 'spray. The middle option is there to separate the shape from the shading '
      + '— without it a win cannot be attributed to either.',
    criterion: {
      working: 'No visible repetition at the play camera, and blades read as '
        + 'rounded rather than as flat strips — a tuft should have a lit side and '
        + 'a shaded side at the same instant.',
      notHelping: 'More than 1.0 ms over the card at equal density. Read the '
        + 'triangle counts in the note: the comparison is not triangle-neutral, so '
        + 'a cost that tracks the triangle ratio is the geometry, not the idea.',
      broken: 'Blades read as spikes or as a bristle brush — the taper too sharp '
        + 'or the twist so strong the two edges shade as different objects.',
    },
    result: '2026-09-12 — refused on cost. **The first refusal was right for the '
      + 'wrong reason and is corrected here.** Version one was broken in four ways '
      + 'at once and I judged it from distant screenshots, which hid all of them: '
      + 'blade width came from `cut.aspect`, which is 0.65 for a spray cut and 0.04 '
      + 'for a blade cut, so one group was ten times the other; there was no real '
      + 'taper, so blades were parallel-sided ribbons with a blunt end; fan, tilt '
      + 'and root spread compounded into a five-foot starfish from a three-foot '
      + 'plant; and the UVs sampled the interior of a cut-out\'s bounding span, '
      + 'which is the transparent gap between scanned blades, so the alpha test '
      + 'punched holes through solid geometry. Looking at one tuft from eight '
      + 'angles showed all four in about a minute. A generated blade cannot be '
      + 'textured from a cut-out atlas at all — it takes its colour from the '
      + 'species table now, with the root-to-tip gradient the wind plugin already '
      + 'had and the scans made unnecessary. Rebuilt: five blades a spray on a '
      + 'golden-angle turn, absolute width from `plant.wide`, a shoulder-then-point '
      + 'taper, 0.3 pi rotated edge normals. It reads as real grass from every '
      + 'angle and **it looks better than the cards close up**. It still costs '
      + '21.0 ms against 47.1 at the play camera on the whole board — 2.2x the '
      + 'frame — so the refusal stands on cost alone. The look objection in the '
      + 'first result was my bug, not the technique.',
  },
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
    result: '2026-09-12 — refused. 10.1 ms on / 9.7 ms off, so it costs 0.4 ms; and on is flatly darker and less saturated across the whole patch, which is the Broken criterion, not the Working one. Change 8.4 against a control of 0.5, so the switch is real. Babylon subtracts (1 - intensity) of diffuse irradiance before adding the transmitted term, and at 0.55 the sward is not getting it back.',
  },
];

export function labFor(id: string | null): LabEntry | undefined {
  return LABS.find(lab => lab.id === id);
}
