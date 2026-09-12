import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import {
  type Build, type Cut, type FoliageSheet, type Vec,
  CARD_SHAPE, cardGeometry, cardShape, cross, lift, spanAt,
} from './foliage-cards';
import type { CardSpec, Plant } from './species';

const BLADES = 2;
const STACKS = 5;
const WIDTH = 0.3;
const SHOULDER = 0.55;
const CURL = 0.26;
const TWIST = 0.3 * Math.PI;
const LEAN = 0.2;
const SPREAD = 0.16;
const TURNS = 2.399963;
const TIP_V = 0.88;

export function bladeGeometry(plant: Plant, sheet: FoliageSheet): VertexData {
  return cardGeometry(plant, sheet, (build, owner, spec, cut, around, index) =>
    spec.group === 'blade'
      ? addBlades(build, owner, spec, cut, around, index)
      : CARD_SHAPE(build, owner, spec, cut, around, index));
}

const TWISTED = cardShape(Math.tan(TWIST));

export function twistedCards(plant: Plant, sheet: FoliageSheet): VertexData {
  return cardGeometry(plant, sheet, TWISTED);
}

function addBlades(
  build: Build, plant: Plant, spec: CardSpec, cut: Cut, around: number, index: number,
): void {
  const vary = 1 + Math.sin(index * 5.17 + spec.tall) * 0.12;
  const tall = spec.tall * vary;
  const lean = spec.flat ? Math.PI / 2 : spec.lean;
  const halfRoot = plant.wide * WIDTH * vary;

  for (let blade = 0; blade < BLADES; blade++) {
    const seed = index * 11 + blade;
    const out = (blade + 0.5) / BLADES;
    addBlade(build, spec, cut, {
      turn: around + blade * TURNS + Math.sin(seed * 12.9898) * 0.25,
      tilt: lean + out * LEAN + Math.sin(seed * 7.31) * 0.07,
      height: tall * (0.78 + 0.4 * fract(seed * 0.618)),
      halfRoot: halfRoot * (0.78 + 0.44 * fract(seed * 0.271)),
      curl: CURL * (0.45 + fract(seed * 0.324)) * (1 - out * 0.45),
      spread: plant.wide * SPREAD * out,
    });
  }
}

interface Blade {
  readonly turn: number;
  readonly tilt: number;
  readonly height: number;
  readonly halfRoot: number;
  readonly curl: number;
  readonly spread: number;
}

function addBlade(build: Build, spec: CardSpec, cut: Cut, of: Blade): void {
  const ca = Math.cos(of.turn);
  const sa = Math.sin(of.turn);
  const cl = Math.cos(of.tilt);
  const sl = Math.sin(of.tilt);
  const across: Vec = [ca, 0, -sa];
  const up: Vec = [sa * sl, cl, ca * sl];
  const away: Vec = cross(across, up);

  const root: Vec = [
    sa * spec.out + across[0] * of.spread,
    spec.at,
    ca * spec.out + across[2] * of.spread,
  ];
  const mid: Vec = scaled(up, of.height * 0.5);
  const tip: Vec = [
    up[0] * of.height + away[0] * of.curl * of.height,
    up[1] * of.height + away[1] * of.curl * of.height,
    up[2] * of.height + away[2] * of.curl * of.height,
  ];

  const first = build.positions.length / 3;
  for (let stack = 0; stack <= STACKS; stack++) {
    const t = stack / STACKS;
    const at = bezier(mid, tip, t);
    const along = unit(slope(mid, tip, t));
    const face = unit(cross(across, along));
    const half = stack === STACKS ? 0 : of.halfRoot * taper(t);
    const v = t * TIP_V;
    const span = spanAt(cut, v);
    const middle = (span[0] + span[1]) / 2;

    for (const side of stack === STACKS ? [0] : [-1, 1]) {
      const across01 = side === 0 ? middle : (side < 0 ? span[0] : span[1]);
      build.positions.push(
        root[0] + at[0] + across[0] * half * side,
        root[1] + at[1] + across[1] * half * side,
        root[2] + at[2] + across[2] * half * side,
      );
      build.normals.push(...lift(turned(face, across, TWIST * side)));
      build.uvs.push(
        cut.u0 + (cut.u1 - cut.u0) * across01,
        cut.v1 + (cut.v0 - cut.v1) * v,
      );
    }
  }

  for (let stack = 0; stack < STACKS - 1; stack++) {
    const a = first + stack * 2;
    build.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = first + (STACKS - 1) * 2;
  build.indices.push(last, last + 1, last + 2);
}

function taper(t: number): number {
  if (t <= SHOULDER) {
    return 1 - 0.18 * (t / SHOULDER);
  }
  const past = (t - SHOULDER) / (1 - SHOULDER);
  return 0.82 * (1 - past) * (1 - past * 0.35);
}

function bezier(mid: Vec, tip: Vec, t: number): Vec {
  const a = 2 * (1 - t) * t;
  const b = t * t;
  return [mid[0] * a + tip[0] * b, mid[1] * a + tip[1] * b, mid[2] * a + tip[2] * b];
}

function slope(mid: Vec, tip: Vec, t: number): Vec {
  const a = 2 * (1 - 2 * t);
  const b = 2 * t;
  return [mid[0] * a + tip[0] * b, mid[1] * a + tip[1] * b, mid[2] * a + tip[2] * b];
}

function turned(face: Vec, axis: Vec, by: number): Vec {
  const c = Math.cos(by);
  const s = Math.sin(by);
  return [face[0] * c + axis[0] * s, face[1] * c + axis[1] * s, face[2] * c + axis[2] * s];
}

function scaled(v: Vec, by: number): Vec {
  return [v[0] * by, v[1] * by, v[2] * by];
}

function unit(v: Vec): Vec {
  const long = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / long, v[1] / long, v[2] / long];
}

function fract(x: number): number {
  return x - Math.floor(x);
}
