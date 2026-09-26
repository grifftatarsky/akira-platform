import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ProceduralTexture } from '@babylonjs/core/Materials/Textures/Procedurals/proceduralTexture';
import { Vector4 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { SplatGround } from '../board-assets';
import type { GroundField } from '../ground-field';
import { grassColor, GRASS_FADE_FROM, GRASS_FADE_TO } from './species';
import { assetUrl } from './assets';

const BAKE_TEXELS_PER_HALF_FOOT = 4;

const BAKE_LIMIT = 8192;

const BAKE_SHADER = `
varying vUV: vec2f;

var fieldSampler: sampler;
var field: texture_2d<f32>;
var layerASampler: sampler;
var layerA: texture_2d<f32>;
var layerBSampler: sampler;
var layerB: texture_2d<f32>;
var layerCSampler: sampler;
var layerC: texture_2d<f32>;

uniform sizing: vec4f;
uniform reach: vec4f;
uniform tintA: vec4f;
uniform tintB: vec4f;
uniform tintC: vec4f;
uniform grass: vec4f;
uniform bakeWhat: vec4f;

fn hash2(p: vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
}

fn shuffled(t: texture_2d<f32>, s: sampler, uv: vec2f) -> vec3f {
  let skewed = vec2f(uv.x + uv.y * -0.57735027, uv.y * 1.15470054) * 3.4641016;
  let cell = floor(skewed);
  let here = skewed - cell;

  var a = cell;
  var b = cell + vec2f(1.0, 0.0);
  let c = cell + vec2f(0.0, 1.0);
  var w = vec3f(1.0 - here.x - here.y, here.x, here.y);
  if (here.x + here.y > 1.0) {
    a = cell + vec2f(1.0, 1.0);
    w = vec3f(here.x + here.y - 1.0, 1.0 - here.y, 1.0 - here.x);
  }

  let dx = dpdx(uv);
  let dy = dpdy(uv);
  let ta = textureSampleGrad(t, s, uv + hash2(a), dx, dy).rgb;
  let tb = textureSampleGrad(t, s, uv + hash2(b), dx, dy).rgb;
  let tc = textureSampleGrad(t, s, uv + hash2(c), dx, dy).rgb;

  let mean = (ta + tb + tc) / 3.0;
  let mixed = ta * w.x + tb * w.y + tc * w.z;
  let spread = inverseSqrt(dot(w, w));
  return clamp(mean + (mixed - mean) * spread, vec3f(0.0), vec3f(1.0));
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let ground = textureSample(field, fieldSampler, uv);
  let wear = ground.r;
  let wet = ground.g;
  let drift = ground.b;

  let toVerge = smoothstep(uniforms.reach.y, uniforms.reach.z, wear);
  let toTrack = smoothstep(uniforms.reach.z, 0.92, wear);
  let wA = 1.0 - toVerge;
  let wB = toVerge * (1.0 - toTrack);
  let wC = toTrack;

  let world = uv * uniforms.sizing.xy;
  let rA = shuffled(layerA, layerASampler, world / (uniforms.sizing.z * 2.0));
  let rB = shuffled(layerB, layerBSampler, world / (uniforms.sizing.w * 2.0));
  let rC = shuffled(layerC, layerCSampler, world / (uniforms.reach.x * 2.0));

  let blended = rA * wA + rB * wB + rC * wC;

  var color = rA * uniforms.tintA.rgb * wA
    + rB * uniforms.tintB.rgb * wB
    + rC * uniforms.tintC.rgb * wC;

  color = color * (0.88 + 0.24 * drift);

  color = mix(color, color * 0.55, wet * 0.8);

  let covered = (1.0 - smoothstep(${GRASS_FADE_FROM.toFixed(2)}, ${GRASS_FADE_TO.toFixed(2)}, wear))
    * uniforms.grass.w;
  color = mix(color, uniforms.grass.rgb * (0.86 + 0.28 * drift), covered);

  let asNormal = normalize(blended * 2.0 - 1.0) * 0.5 + 0.5;
  fragmentOutputs.color = vec4f(
    select(select(color, blended, uniforms.bakeWhat.x > 1.5), asNormal,
      abs(uniforms.bakeWhat.x - 1.0) < 0.5),
    1.0);
}
`;

export function fieldTexture(field: GroundField, scene: Scene): RawTexture {
  const texture = RawTexture.CreateRGBATexture(
    field.data, field.width, field.height, scene, false, false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

export function bakeGround(
  ground: SplatGround, field: GroundField, scene: Scene,
): {
  macro: ProceduralTexture;
  relief: ProceduralTexture;
  surface: ProceduralTexture;
  sources: Texture[];
} {
  const widthFeet = field.extentXHalfFeet;
  const heightFeet = field.extentYHalfFeet;
  const scale = Math.min(
    BAKE_TEXELS_PER_HALF_FOOT,
    BAKE_LIMIT / Math.max(widthFeet, heightFeet),
  );
  const width = Math.min(BAKE_LIMIT, Math.round(widthFeet * scale));
  const height = Math.min(BAKE_LIMIT, Math.round(heightFeet * scale));

  const load = (path: string, data: boolean): Texture => {
    const texture = new Texture(assetUrl(path), scene, false, false);
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    if (data) {
      texture.gammaSpace = false;
    }
    return texture;
  };
  const sources = ground.layers.map(layer => load(layer.color, false));
  const normals = ground.layers.map(layer => load(layer.normal, true));
  const arms = ground.layers.map(layer => load(layer.arm, true));

  const source = fieldTexture(field, scene);

  const bake = (name: string, layers: Texture[], what: number): ProceduralTexture => {
    const made = new ProceduralTexture(
      name, { width, height }, { fragmentSource: BAKE_SHADER }, scene,
      { shaderLanguage: ShaderLanguage.WGSL, generateMipMaps: true },
    );
    made.refreshRate = 0;
    made.wrapU = Texture.CLAMP_ADDRESSMODE;
    made.wrapV = Texture.CLAMP_ADDRESSMODE;
    if (what > 0) {
      made.gammaSpace = false;
    }
    made.setTexture('field', source);
    layers.forEach((texture, index) => {
      made.setTexture(['layerA', 'layerB', 'layerC'][index], texture);
    });
    made.setVector4('bakeWhat', new Vector4(what, 0, 0, 0));
    return made;
  };

  const macro = bake('groundMacro', sources, 0);

  const relief = bake('groundRelief', normals, 1);
  const surface = bake('groundSurface', arms, 2);

  const grass = grassColor();
  for (const made of [macro, relief, surface]) {
    made.setVector4('sizing', new Vector4(
      widthFeet, heightFeet, ground.layers[0].feet, ground.layers[1].feet,
    ));
    made.setVector4('reach', new Vector4(ground.layers[2].feet, 0.12, 0.55, 0));
    ground.layers.forEach((layer, index) => {
      const tint = layer.tint ?? [1, 1, 1];
      made.setVector4(
        ['tintA', 'tintB', 'tintC'][index],
        new Vector4(tint[0], tint[1], tint[2], 1),
      );
    });
    made.setVector4('grass', new Vector4(grass[0], grass[1], grass[2], 0.72));
  }

  const every = [...sources, ...normals, ...arms];
  const ready = scene.onBeforeRenderObservable.add(() => {
    if (!every.every(texture => texture.isReady())) {
      return;
    }

    macro.resetRefreshCounter();
    relief.resetRefreshCounter();
    surface.resetRefreshCounter();
    scene.onBeforeRenderObservable.remove(ready);
  });

  return { macro, relief, surface, sources: [...every, source] };
}

export { BAKE_TEXELS_PER_HALF_FOOT };
