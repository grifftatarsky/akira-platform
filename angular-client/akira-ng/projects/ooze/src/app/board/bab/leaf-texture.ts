import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { ProceduralTexture } from '@babylonjs/core/Materials/Textures/Procedurals/proceduralTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Vector4 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Materials/Textures/Procedurals/proceduralTextureSceneComponent';
import type { Plant } from './species';

/**
 * A plant's surface, baked once.
 *
 * <p>The same bargain as the ground: work out the answer once into a texture
 * and sample it thereafter. Nothing here changes between frames, so it can be
 * as careful as it likes — veins, mottling, a dried edge, a paler midrib — for
 * one frame of cost at load and one texture fetch afterwards.
 *
 * <p><b>It is what the plants were missing.</b> Every one of them was flat
 * albedo times a root-to-tip ramp: a green card, and a field of green cards
 * reads as a green surface however good the silhouette is. A leaf is not one
 * colour. It is paler along the rib, darker and drier at the edge, veined
 * across, and mottled everywhere.
 *
 * <p>The alpha channel is thickness rather than opacity — thin at the edges and
 * the tip, thick along the rib — which is what the material's translucency
 * reads to decide how much light comes through from behind. That is the effect
 * that makes a low sun through a meadow glow instead of going dark.
 */

const LEAF = `
varying vUV: vec2f;

uniform base: vec4f;      // rgb, and where the leaf band ends
uniform tip: vec4f;       // rgb, and how hard the vein pattern reads
uniform bloom: vec4f;     // rgb of the ray florets, and where they start
uniform ribs: vec4f;      // vein count, sweep, mottle, dryness
// Nought bakes the leaf's colour; one bakes its thickness into every channel.
// One shader for both so the two can never disagree about where a vein is.
uniform bakeThickness: f32;

fn hash2(p: vec2f) -> f32 {
  let q = fract(p * vec2f(0.1031, 0.1030));
  let r = q + dot(q, q.yx + 33.33);
  return fract((r.x + r.y) * r.x);
}

// Value noise, smoothed. Mottling is the difference between a printed leaf and
// a grown one, and it wants to be organic rather than regular.
fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let w = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), w.x),
    mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), w.x), w.y);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let across = input.vUV.x;
  let along = input.vUV.y;
  // Distance from the midrib, nought at the middle and one at either edge.
  let fromRib = abs(across - 0.5) * 2.0;

  // The leaf's own band. Above it, the plant is in flower or in seed.
  let leafTo = uniforms.base.w;
  let bloomFrom = uniforms.bloom.w;
  let up = clamp(along / max(0.001, leafTo), 0.0, 1.0);

  var colour = mix(uniforms.base.rgb, uniforms.tip.rgb, pow(up, 1.35));

  // <b>The midrib.</b> Paler than the blade either side of it, and the single
  // most identifying mark on a leaf at any distance.
  let rib = 1.0 - smoothstep(0.0, 0.16, fromRib);
  colour = mix(colour, colour * 1.22 + vec3f(0.02), rib * 0.75);

  // Veins. Parallel down the leaf for a plantain, swept toward the tip for
  // anything broader; none at all where the count is zero.
  let count = uniforms.ribs.x;
  if (count > 0.5) {
    let lane = fract((across - 0.5) * count + along * uniforms.ribs.y);
    let vein = 1.0 - smoothstep(0.0, 0.09, abs(lane - 0.5));
    colour = mix(colour, colour * 1.16, vein * uniforms.tip.w * (1.0 - rib));
  }

  // Mottling, and a drier edge. Light does not reach the middle of a grass
  // evenly and a leaf's rim is the first part of it to give up.
  let mottle = noise(vec2f(across * 7.0, along * 22.0)) - 0.5;
  colour *= 1.0 + mottle * uniforms.ribs.z;
  let dry = smoothstep(0.62, 1.0, fromRib) * uniforms.ribs.w;
  colour = mix(colour, colour * vec3f(1.22, 1.02, 0.6), dry);

  // Above the leaf band: the ray florets or the seed head.
  let flowering = smoothstep(bloomFrom - 0.04, bloomFrom + 0.02, along);
  let petal = uniforms.bloom.rgb
    * (0.86 + 0.14 * noise(vec2f(across * 9.0, along * 40.0)));
  colour = mix(colour, petal, flowering * step(0.001, dot(uniforms.bloom.rgb, vec3f(1.0))));

  // <b>Alpha is thickness, not opacity.</b> Thin at the edge and the tip where
  // the light comes straight through, thick along the rib where it does not.
  let thickness = clamp(
    0.22 + 0.7 * (1.0 - fromRib) * (1.0 - up * 0.55) + rib * 0.25, 0.0, 1.0);

  // <b>Thickness goes out as a colour when asked for.</b> Babylon's subsurface
  // reads thickness from a texture's *red* channel, remapped between the
  // material's minimum and maximum — it cannot read it out of an albedo map's
  // alpha, which is where this used to put it and where nothing ever read it.
  // Baking it from this same shader rather than a second one is what guarantees
  // the thickness agrees with the colour about where the rib is.
  // A select rather than an early return: Babylon wraps this body, so a bare
  // return here is "returned 'void', expected 'FragmentOutputs'".
  fragmentOutputs.color = select(
    vec4f(colour, thickness),
    vec4f(thickness, thickness, thickness, 1.0),
    uniforms.bakeThickness > 0.5);
}
`;

/** Texels across a leaf and along it. Small: it is looked at from ten feet. */
const WIDE = 128;
const LONG = 256;

/**
 * And smaller again for thickness.
 *
 * <p>Thickness is a smooth function of where you are on the leaf — near the rib
 * or near the edge, near the root or near the tip — with none of the mottle or
 * vein detail that makes the colour map want resolution. A quarter of the size
 * in each direction is indistinguishable and costs a sixteenth of the memory.
 */
const THICK_WIDE = 32;
const THICK_LONG = 64;

/**
 * Bakes one plant's leaf surface.
 *
 * <p>Rendered by the scene on its next frame rather than by an explicit call:
 * on WebGPU the commands go into a frame's encoder, so a render started
 * outside one is never submitted.
 */
export function leafTexture(plant: Plant, scene: Scene): ProceduralTexture {
  const texture = bake(plant, scene, `leaf-${plant.id}`, WIDE, LONG, 0);
  // <b>These are linear albedo, not picked colours.</b> Babylon assumes every
  // colour texture is gamma-encoded and puts it through sRGB-to-linear in the
  // PBR shader, and the shader above writes the species table straight out —
  // numbers chosen as reflectances, with grass sitting at a luminance of 0.25,
  // which is exactly the measured albedo of short green grass.
  //
  // <p>Left flagged as gamma, that conversion ran anyway, and it is not a
  // dimmer — it is a curve. A root at 0.13 came out at 0.015, eight and a half
  // times darker; a tip at 0.63 came out at 0.355, less than twice. So a second
  // root-to-tip ramp, far steeper than the one the wind plugin applies on
  // purpose, was being multiplied in underneath it. That is a black-at-the-base
  // signature, and it is there with the sun off and every normal pointing at
  // the sky.
  texture.gammaSpace = false;
  return texture;
}

/**
 * The same leaf's thickness, where the material's translucency can read it.
 *
 * <p>Thin at the edge and the tip where light comes straight through, thick
 * along the rib where it does not. Without it every leaf is uniformly
 * translucent, which is the same as none of them being translucent: the effect
 * lives entirely in the variation.
 */
export function leafThickness(plant: Plant, scene: Scene): ProceduralTexture {
  const texture = bake(plant, scene, `thick-${plant.id}`, THICK_WIDE, THICK_LONG, 1);
  // Data, not colour. Flagged gamma it would be run through sRGB-to-linear and
  // every leaf would read as thinner than it is, most of all near the edges.
  texture.gammaSpace = false;
  return texture;
}

/**
 * Bakes one plant's surface.
 *
 * <p>Rendered by the scene on its next frame rather than by an explicit call:
 * on WebGPU the commands go into a frame's encoder, so a render started
 * outside one is never submitted.
 */
function bake(
  plant: Plant, scene: Scene, name: string,
  wide: number, long: number, thickness: number,
): ProceduralTexture {
  const texture = new ProceduralTexture(
    name, { width: wide, height: long },
    { fragmentSource: LEAF }, scene,
    { shaderLanguage: ShaderLanguage.WGSL, generateMipMaps: true },
  );
  texture.refreshRate = 0;
  // <b>The alpha is data, not opacity.</b> Left flagged as alpha, Babylon takes
  // the material into its transparent path: blended, depth-sorted and drawn
  // back to front, which on six hundred thousand plants is both wrong to look
  // at and enormously more expensive — 29 ms against 8.
  texture.hasAlpha = false;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;

  const heads = plant.petals > 0 || plant.spikelets > 0;
  // Where the leaves stop and the flower or seed head starts, in the same
  // coordinate the geometry writes into its uv: height up the whole plant.
  const leafTo = heads ? 0.6 : 1;
  const bloomFrom = plant.petals > 0 ? 0.92 : (plant.spikelets > 0 ? 0.66 : 2);

  texture.setVector4('base', new Vector4(...plant.base, leafTo));
  texture.setVector4('tip', new Vector4(...plant.tip, plant.veins > 0 ? 0.9 : 0));
  texture.setVector4('bloom', new Vector4(...plant.bloom, bloomFrom));
  texture.setVector4('ribs', new Vector4(
    plant.veins, plant.sweep, 0.17, plant.id === 'grass' ? 0.5 : 0.28,
  ));
  texture.setFloat('bakeThickness', thickness);
  return texture;
}
