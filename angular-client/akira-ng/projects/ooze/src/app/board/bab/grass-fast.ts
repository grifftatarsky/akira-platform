import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Vector4 } from '@babylonjs/core/Maths/math.vector';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';

import type { FoliageSheet } from './foliage-cards';
import type { Meadow, Sown } from './meadow';
import type { Stage } from './stage';

const VERTEX = `
attribute position : vec3<f32>;
attribute normal : vec3<f32>;
attribute uv : vec2<f32>;
attribute color : vec4<f32>;
attribute world0 : vec4<f32>;
attribute world1 : vec4<f32>;
attribute world2 : vec4<f32>;
attribute world3 : vec4<f32>;

uniform viewProjection : mat4x4<f32>;
uniform windAim : vec4<f32>;
uniform windTip : vec4<f32>;
uniform windGround : vec4<f32>;
uniform windTall : vec4<f32>;

varying vNormalW : vec3<f32>;
varying vShade : vec3<f32>;
varying vUV : vec2<f32>;
varying vPositionW : vec3<f32>;

@vertex
fn main(input : VertexInputs) -> FragmentInputs {
  var place = vertexInputs.position;
  let bladeAlong = clamp(place.y / uniforms.windTall.x, 0.0, 1.0);

  let root = vertexInputs.world3.xyz;
  let root2 = floor(vertexInputs.world3.xz * 8.0);
  var hashed = (u32(abs(root2.x) + 4096.0) * 73856093u)
    ^ (u32(abs(root2.y) + 4096.0) * 19349663u);
  hashed ^= hashed >> 13u;
  hashed *= 0x5bd1e995u;
  hashed ^= hashed >> 15u;
  let dice = f32(hashed & 0xffffffu) / 16777216.0;
  let t = uniforms.windAim.w;
  let downwind2 = normalize(vec2f(uniforms.windAim.x, uniforms.windAim.y));
  let drift = root.xz - downwind2 * t * 11.0;
  let slow = root.xz - downwind2 * t * 14.0;

  let grain = 1.0 / uniforms.windGround.z;
  let f1 = sin(dot(drift, vec2f(0.076, 0.048) * grain));
  let f2 = sin(dot(drift, vec2f(-0.032, 0.092) * grain) + 2.1);
  let f3 = sin(dot(slow, vec2f(0.0136, 0.0102) * grain) + 4.3);
  let gustField = f1 * 0.5 + f2 * 0.5 + uniforms.windGround.w;
  let weather = 0.5 + 0.5 * f3;

  let gust = smoothstep(-0.9, 0.5, gustField) * (0.25 + 0.75 * weather);
  let flutter = sin(t * (5.0 + 5.0 * dice) + dice * 37.0) * 0.16 * gust;
  let over = min(1.6, uniforms.windAim.z * (0.08 + 1.35 * gust + flutter));

  let c1 = vec2f(over * 0.10, 0.55);
  let c2 = vec2f(over * 0.72, max(0.2, 1.0 - over * over * 0.22));
  let m1 = mix(vec2f(0.0, 0.0), c1, bladeAlong);
  let m2 = mix(c1, c2, bladeAlong);
  let curve = mix(m1, m2, bladeAlong);

  let sideways = normalize(vertexInputs.world0.xyz);
  let facing = normalize(vertexInputs.world2.xyz);
  let downwind = vec3f(uniforms.windAim.x, 0.0, uniforms.windAim.y);

  let curl = uniforms.windGround.y * (0.35 + 0.65 * dice);
  let arc = place.y;
  let turned = clamp(curl * arc, -1.5, 1.5);
  let straight = curl < 0.0001;
  let rise = select(sin(turned) / curl, arc, straight);
  let reach = select((1.0 - cos(turned)) / curl, 0.0, straight);

  let sink = max(0.2, 1.0 - over * over * 0.18 * bladeAlong);
  place = vec3f(
    place.x + curve.x * dot(downwind, sideways),
    rise * sink,
    place.z + curve.x * dot(downwind, facing) + reach);

  let stand = mat4x4<f32>(
    vertexInputs.world0, vertexInputs.world1, vertexInputs.world2, vertexInputs.world3);
  let standing = stand * vec4f(place, 1.0);
  vertexOutputs.position = uniforms.viewProjection * standing;
  vertexOutputs.vPositionW = standing.xyz;
  vertexOutputs.vUV = vertexInputs.uv;

  let turn = mat3x3<f32>(stand[0].xyz, stand[1].xyz, stand[2].xyz);
  let leafN = normalize(turn * vertexInputs.normal);
  let carried = vertexInputs.world1.xyz;
  let ground = select(
    vec3f(0.0, 1.0, 0.0), normalize(carried), dot(carried, carried) > 0.0001);
  var lit = normalize(mix(leafN, ground, uniforms.windGround.x));
  lit.y = max(lit.y, 0.08);
  vertexOutputs.vNormalW = normalize(lit);

  let enclosed = vertexInputs.color.a;
  let floorHere = mix(1.0, uniforms.windTip.w, enclosed);
  let shade = mix(floorHere, 1.0, bladeAlong * bladeAlong * 0.55 + bladeAlong * 0.45);
  let toTip = mix(vec3f(1.0), uniforms.windTip.rgb, bladeAlong * bladeAlong);
  vertexOutputs.vShade = vertexInputs.color.rgb * shade * toTip;
}
`;

const FRAGMENT = `
varying vNormalW : vec3<f32>;
varying vShade : vec3<f32>;
varying vUV : vec2<f32>;
varying vPositionW : vec3<f32>;

var sheetSampler : sampler;
var sheet : texture_2d<f32>;

uniform wash : vec4<f32>;
uniform sunAt : vec4<f32>;
uniform sunLit : vec4<f32>;
uniform skyLit : vec4<f32>;
uniform earthLit : vec4<f32>;
uniform bounceAt : vec4<f32>;
uniform bounceLit : vec4<f32>;
uniform eyeAt : vec4<f32>;

fn sheen(n: vec3f, toEye: vec3f, toLight: vec3f, ndl: f32, ndv: f32) -> f32 {
  let between = normalize(toLight + toEye);
  let ndh = clamp(dot(n, between), 0.0, 1.0);
  let vdh = clamp(dot(toEye, between), 0.0, 1.0);
  let slope = 0.3030;
  let slope2 = slope * slope;
  let tail = ndh * ndh * (slope2 - 1.0) + 1.0;
  let spread = slope2 / (3.14159265 * tail * tail);
  let shadowed = 0.5 / max(1e-4,
    ndl * (ndv * (1.0 - slope) + slope) + ndv * (ndl * (1.0 - slope) + slope));
  let rim = 0.04 + 0.96 * pow(1.0 - vdh, 5.0);
  return spread * shadowed * rim * ndl;
}

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
  let cut = textureSample(sheet, sheetSampler, fragmentInputs.vUV);
  if (cut.a < uniforms.wash.w) {
    discard;
  }
  let n = normalize(fragmentInputs.vNormalW);
  let toEye = normalize(uniforms.eyeAt.xyz - fragmentInputs.vPositionW);
  let up = vec3f(0.0, 1.0, 0.0);
  let albedo = uniforms.wash.rgb * pow(cut.rgb, vec3f(2.2)) * fragmentInputs.vShade;

  let sunFace = max(dot(n, uniforms.sunAt.xyz), 0.0);
  let bounceFace = max(dot(n, uniforms.bounceAt.xyz), 0.0);
  let skyFace = dot(n, up) * 0.5 + 0.5;

  let flat = (sunFace * uniforms.sunLit.rgb + bounceFace * uniforms.bounceLit.rgb)
    * 0.3183099 + mix(uniforms.earthLit.rgb, uniforms.skyLit.rgb, skyFace);
  var gloss = vec3f(0.0);
  if (uniforms.eyeAt.w > 0.5) {
    let ndv = max(dot(n, toEye), 1e-4);
    gloss =
        sheen(n, toEye, uniforms.sunAt.xyz, sunFace, ndv) * uniforms.sunLit.rgb
      + sheen(n, toEye, uniforms.bounceAt.xyz, bounceFace, ndv) * uniforms.bounceLit.rgb
      + sheen(n, toEye, up, skyFace, ndv) * uniforms.skyLit.rgb;
  }

  fragmentOutputs.color = vec4f(albedo * flat * 0.96 + gloss, 1.0);
}
`;

export interface FastGrass {
  readonly materials: readonly ShaderMaterial[];
  on(want: boolean): void;
  sheen(want: boolean): void;
  wearing(): boolean;
  dispose(): void;
}

export function fastGrass(meadow: Meadow, sheet: FoliageSheet, stage: Stage): FastGrass {
  const scene = stage.scene;
  const grown = new Map<Sown, Material>();
  const fast: ShaderMaterial[] = [];

  for (const sown of meadow.sown) {
    const material = new ShaderMaterial(
      `fast-${sown.plant.id}`, scene,
      { vertexSource: VERTEX, fragmentSource: FRAGMENT },
      {
        attributes: ['position', 'normal', 'uv', 'color'],
        uniforms: [
          'viewProjection', 'windAim', 'windTip', 'windGround', 'windTall',
          'wash', 'sunAt', 'sunLit', 'skyLit', 'earthLit', 'bounceAt', 'bounceLit',
          'eyeAt',
        ],
        samplers: ['sheet'],
        needAlphaTesting: true,
        needAlphaBlending: false,
        shaderLanguage: ShaderLanguage.WGSL,
      },
    );
    material.backFaceCulling = false;
    material.setTexture('sheet', sheet.texture);
    const wash = sown.plant.wash ?? [1, 1, 1];
    material.setVector4('wash', new Vector4(wash[0], wash[1], wash[2], 0.28));
    grown.set(sown, sown.mesh.material!);
    fast.push(material);
  }

  const aim = new Vector4(0, 0, 0, 0);
  const tip = new Vector4(0, 0, 0, 0);
  const ground = new Vector4(0, 0, 0, 0);
  const tall = new Vector4(1, 0, 0, 0);
  const sunAt = new Vector4(0, 1, 0, 0);
  const sunLit = new Vector4(0, 0, 0, 0);
  const skyLit = new Vector4(0, 0, 0, 0);
  const earthLit = new Vector4(0, 0, 0, 0);
  const bounceAt = new Vector4(0, 1, 0, 0);
  const bounceLit = new Vector4(0, 0, 0, 0);
  const eyeAt = new Vector4(0, 0, 0, 0);

  function sync(): void {
    const eye = scene.activeCamera?.globalPosition;
    if (eye) {
      eyeAt.set(eye.x, eye.y, eye.z, glossy ? 1 : 0);
    }
    const sun = stage.sun;
    const lit = sun.isEnabled() ? sun.intensity : 0;
    sunAt.set(-sun.direction.x, -sun.direction.y, -sun.direction.z, 0);
    sunLit.set(sun.diffuse.r * lit, sun.diffuse.g * lit, sun.diffuse.b * lit, 0);

    const bounce = stage.bounce;
    const thrown = bounce.isEnabled() ? bounce.intensity : 0;
    bounceAt.set(-bounce.direction.x, -bounce.direction.y, -bounce.direction.z, 0);
    bounceLit.set(
      bounce.diffuse.r * thrown, bounce.diffuse.g * thrown, bounce.diffuse.b * thrown, 0,
    );

    const sky = stage.ambient;
    const over = sky.isEnabled() ? sky.intensity : 0;
    skyLit.set(sky.diffuse.r * over, sky.diffuse.g * over, sky.diffuse.b * over, 0);
    earthLit.set(
      sky.groundColor.r * over, sky.groundColor.g * over, sky.groundColor.b * over, 0,
    );

    meadow.sown.forEach((sown, at) => {
      const material = fast[at];
      const wind = sown.wind;
      const downwind = Math.hypot(wind.eastward, wind.northward) || 1;
      aim.set(
        wind.eastward / downwind, wind.northward / downwind, wind.strength, wind.time,
      );
      tip.set(wind.tip[0], wind.tip[1], wind.tip[2], wind.floor);
      ground.set(
        wind.ground, wind.droop, Math.max(0.05, wind.patchSize), wind.gustBias,
      );
      tall.set(Math.max(0.05, wind.tall), 0, 0, 0);
      material.setVector4('windAim', aim);
      material.setVector4('windTip', tip);
      material.setVector4('windGround', ground);
      material.setVector4('windTall', tall);
      material.setVector4('sunAt', sunAt);
      material.setVector4('sunLit', sunLit);
      material.setVector4('skyLit', skyLit);
      material.setVector4('earthLit', earthLit);
      material.setVector4('bounceAt', bounceAt);
      material.setVector4('bounceLit', bounceLit);
      material.setVector4('eyeAt', eyeAt);
    });
  }

  let ticker: Observer<Scene> | null = null;
  let worn = false;
  let glossy = true;

  return {
    materials: fast,
    wearing: (): boolean => worn,
    sheen(want: boolean): void {
      glossy = want;
      if (worn) {
        sync();
      }
    },
    on(want: boolean): void {
      if (want === worn) {
        return;
      }
      worn = want;
      if (want) {
        sync();
        meadow.sown.forEach((sown, at) => { sown.mesh.material = fast[at]; });
        ticker = scene.onBeforeRenderObservable.add(sync);
      } else {
        for (const sown of meadow.sown) {
          sown.mesh.material = grown.get(sown)!;
        }
        if (ticker) {
          scene.onBeforeRenderObservable.remove(ticker);
          ticker = null;
        }
      }
    },
    dispose(): void {
      if (ticker) {
        scene.onBeforeRenderObservable.remove(ticker);
      }
      for (const sown of meadow.sown) {
        const was = grown.get(sown);
        if (was && worn) {
          sown.mesh.material = was;
        }
      }
      fast.forEach(material => material.dispose());
    },
  };
}
