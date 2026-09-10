import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ProceduralTexture } from '@babylonjs/core/Materials/Textures/Procedurals/proceduralTexture';
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { SplatGround } from '../board-assets';
import type { GroundField } from '../ground-field';
import { assetUrl } from './assets';

/**
 * The ground's colour, worked out once and kept.
 *
 * <p><b>This is the whole reason for the port.</b> The old ground evaluated its
 * splat — three layers, stochastic tiling at three taps each, two scale bands,
 * fifty samplers — at every pixel of every frame, and a GPU timer put that at
 * 93.5 ms to cover a 1404 × 726 screen. Five and a half times an entire 60 fps
 * budget, for an answer that is identical from one frame to the next.
 *
 * <p>So it is computed once, into a texture the size of the board, and after
 * that the terrain samples one image. Nothing about the arithmetic below is
 * cheap and nothing about it needs to be: it runs at load, and it would run
 * again only over the rectangle a brush had touched.
 *
 * <p>That the board is small is what makes this work and what makes a virtual
 * texture unnecessary. The road is 220 by 150 feet. At four texels to the
 * half-foot the whole of it is 1760 × 1200 — one texture, no page table, no
 * feedback pass, no residency scheduler. An open world needs all three; a
 * tabletop encounter needs none of them.
 */

/** Texels per half-foot in the baked map. */
const BAKE_TEXELS_PER_HALF_FOOT = 4;

/** Nothing larger, whatever the board. WebGPU guarantees 8192 and no more. */
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

uniform extentHalfFeet: vec2f;
uniform layerFeet: vec3f;
uniform tintA: vec3f;
uniform tintB: vec3f;
uniform tintC: vec3f;

// Stochastic tiling, in the triangle-grid form: three taps at hashed offsets,
// weighted by where the point falls in its triangle. A photograph tiled
// straight reads as wallpaper at the fourth repeat — the eye finds the period
// long before it finds the detail — and this breaks the period without
// breaking the material.
fn hash2(p: vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
}

fn shuffled(t: texture_2d<f32>, s: sampler, uv: vec2f) -> vec3f {
  // Skew the square grid into equilateral triangles, so a point has three
  // neighbours at equal weight rather than four at unequal ones.
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

  // Explicit gradients: the hashed offsets are discontinuous across a cell
  // edge, and letting the hardware derive the mip from them picks the smallest
  // one along every seam.
  let dx = dpdx(uv);
  let dy = dpdy(uv);
  let ta = textureSampleGrad(t, s, uv + hash2(a), dx, dy).rgb;
  let tb = textureSampleGrad(t, s, uv + hash2(b), dx, dy).rgb;
  let tc = textureSampleGrad(t, s, uv + hash2(c), dx, dy).rgb;

  // Blend toward the mean in linear space, then push the contrast back. A
  // straight weighted average of three photographs is flatter than any of
  // them, which is the well-known failure of this technique.
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

  // Three layers chosen by how worn the ground is: lush, verge, bare track.
  // The middle one has to be a band rather than a threshold, or the road gets
  // an outline instead of an edge.
  let toVerge = smoothstep(0.12, 0.55, wear);
  let toTrack = smoothstep(0.55, 0.92, wear);
  let wA = 1.0 - toVerge;
  let wB = toVerge * (1.0 - toTrack);
  let wC = toTrack;

  // Repeats per axis, from feet-per-repeat and the board's real extent — a
  // single scalar would stretch the material on a board that is not square.
  let world = uv * uniforms.extentHalfFeet;
  let cA = shuffled(layerA, layerASampler, world / (uniforms.layerFeet.x * 2.0)) * uniforms.tintA;
  let cB = shuffled(layerB, layerBSampler, world / (uniforms.layerFeet.y * 2.0)) * uniforms.tintB;
  let cC = shuffled(layerC, layerCSampler, world / (uniforms.layerFeet.z * 2.0)) * uniforms.tintC;

  var color = cA * wA + cB * wB + cC * wC;

  // The slow field across the board, so a tiling material stops reading as one
  // material. Small, and multiplicative, so it cannot invent a colour.
  color = color * (0.88 + 0.24 * drift);

  // Wet ground is darker and less varied — water fills the pores, so the
  // scattering that lightens dry dirt stops happening.
  color = mix(color, color * 0.55, wet * 0.8);

  fragmentOutputs.color = vec4f(color, 1.0);
}
`;

/** The field's wear, wetness and drift as something a shader can read. */
export function fieldTexture(field: GroundField, scene: Scene): RawTexture {
  const texture = RawTexture.CreateRGBATexture(
    field.data, field.width, field.height, scene, false, false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/**
 * Bakes the ground's colour for a board.
 *
 * <p>Rendered on demand rather than by the scene: `refreshRate` of zero and one
 * explicit `render()`, so this costs one frame at load and nothing afterwards.
 */
export function bakeGround(
  ground: SplatGround, field: GroundField, scene: Scene,
): { macro: ProceduralTexture; sources: Texture[] } {
  const widthFeet = field.extentXHalfFeet;
  const heightFeet = field.extentYHalfFeet;
  const scale = Math.min(
    BAKE_TEXELS_PER_HALF_FOOT,
    BAKE_LIMIT / Math.max(widthFeet, heightFeet),
  );
  const width = Math.min(BAKE_LIMIT, Math.round(widthFeet * scale));
  const height = Math.min(BAKE_LIMIT, Math.round(heightFeet * scale));

  const sources = ground.layers.map(layer => {
    const texture = new Texture(assetUrl(layer.color), scene, false, false);
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    return texture;
  });

  const macro = new ProceduralTexture(
    'groundMacro', { width, height }, { fragmentSource: BAKE_SHADER }, scene,
    { shaderLanguage: ShaderLanguage.WGSL, generateMipMaps: true },
  );
  macro.refreshRate = 0;
  macro.wrapU = Texture.CLAMP_ADDRESSMODE;
  macro.wrapV = Texture.CLAMP_ADDRESSMODE;
  macro.setTexture('field', fieldTexture(field, scene));
  sources.forEach((texture, index) => {
    macro.setTexture(['layerA', 'layerB', 'layerC'][index], texture);
  });

  macro.setVector2('extentHalfFeet', new Vector2(widthFeet, heightFeet));
  macro.setVector3('layerFeet', new Vector3(
    ground.layers[0].feet, ground.layers[1].feet, ground.layers[2].feet,
  ));
  ground.layers.forEach((layer, index) => {
    const tint = layer.tint ?? [1, 1, 1];
    macro.setVector3(
      ['tintA', 'tintB', 'tintC'][index],
      new Vector3(tint[0], tint[1], tint[2]),
    );
  });

  return { macro, sources };
}

export { BAKE_TEXELS_PER_HALF_FOOT };
