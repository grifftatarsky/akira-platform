import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import {
  type Build, type Cut, type FoliageSheet, type Vec,
  cardGeometry, cardShape, cross, lift, spanAt,
} from './foliage-cards';
import type { CardSpec, Plant } from './species';

const BLADES = 7;
const STACKS = 3;
const CURL = 0.3;
const TWIST = 0.3 * Math.PI;
const FAN = 0.34;
const TAPER = 0.5;
const SLIM = 14;

export function bladeGeometry(plant: Plant, sheet: FoliageSheet): VertexData {
  return cardGeometry(plant, sheet, addBlades);
}

const TWISTED = cardShape(Math.tan(TWIST));

export function twistedCards(plant: Plant, sheet: FoliageSheet): VertexData {
  return cardGeometry(plant, sheet, TWISTED);
}

export function bladeTriangles(): number {
  return BLADES * (2 * STACKS - 1);
}

function addBlades(
  build: Build, plant: Plant, spec: CardSpec, cut: Cut, around: number, index: number,
): void {
  const wide = spec.tall * cut.aspect;
  const vary = 1 + Math.sin(index * 5.17 + spec.tall) * 0.12;
  const tall = spec.tall * vary;
  const lean = spec.flat ? Math.PI / 2 : spec.lean;

  for (let blade = 0; blade < BLADES; blade++) {
    const seed = index * 11 + blade;
    const offset = blade - (BLADES - 1) / 2;
    const turn = around + offset * FAN + Math.sin(seed * 12.9898) * 0.22;
    const tilt = lean + Math.abs(offset) * 0.2 + Math.sin(seed * 7.31) * 0.1;
    const height = tall * (0.82 + 0.34 * fract(seed * 0.618));
    const halfRoot = (wide * 0.5 * vary) / SLIM;
    const curl = CURL * (0.5 + 1.0 * fract(seed * 0.324));
    const spread = offset * (wide * vary * 0.09);
    addBlade(build, spec, cut, turn, tilt, height, halfRoot, curl, blade, spread);
  }
}

function addBlade(
  build: Build, spec: CardSpec, cut: Cut,
  turn: number, tilt: number, height: number, halfRoot: number,
  curl: number, blade: number, spread: number,
): void {
  const ca = Math.cos(turn);
  const sa = Math.sin(turn);
  const cl = Math.cos(tilt);
  const sl = Math.sin(tilt);
  const across: Vec = [ca, 0, -sa];
  const up: Vec = [sa * sl, cl, ca * sl];
  const away: Vec = cross(across, up);

  const root: Vec = [
    sa * spec.out + across[0] * spread,
    spec.at + across[1] * spread,
    ca * spec.out + across[2] * spread,
  ];
  const mid: Vec = [up[0] * height * 0.5, up[1] * height * 0.5, up[2] * height * 0.5];
  const tip: Vec = [
    up[0] * height + away[0] * curl * height,
    up[1] * height + away[1] * curl * height,
    up[2] * height + away[2] * curl * height,
  ];

  const first = build.positions.length / 3;
  for (let stack = 0; stack <= STACKS; stack++) {
    const t = stack / STACKS;
    const at = bezier(mid, tip, t);
    const along = normalize(slope(mid, tip, t));
    const face = normalize(cross(across, along));
    const half = stack === STACKS ? 0 : halfRoot * Math.pow(1 - t, TAPER);
    const span = spanAt(cut, t);
    const middle = span[0] + (span[1] - span[0]) * (0.18 + 0.64 * fract(blade * 0.618));
    const reach = (span[1] - span[0]) * 0.06;

    for (const side of stack === STACKS ? [0] : [-1, 1]) {
      build.positions.push(
        root[0] + at[0] + across[0] * half * side,
        root[1] + at[1] + across[1] * half * side,
        root[2] + at[2] + across[2] * half * side,
      );
      build.normals.push(...lift(turned(face, across, TWIST * side)));
      build.uvs.push(
        cut.u0 + (cut.u1 - cut.u0) * (middle + reach * side),
        cut.v1 + (cut.v0 - cut.v1) * t,
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

function normalize(v: Vec): Vec {
  const long = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / long, v[1] / long, v[2] / long];
}

function fract(x: number): number {
  return x - Math.floor(x);
}
