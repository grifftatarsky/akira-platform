import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ProceduralTexture } from '@babylonjs/core/Materials/Textures/Procedurals/proceduralTexture';
import { Vector4 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { SplatGround } from '../board-assets';
import type { GroundField } from '../ground-field';
import { swardColor } from './species';
// Side-effect, and the second time this exact trap has been hit: without the
// scene component a `ProceduralTexture` is never added to the scene's render
// list, so it is never drawn. It still reports `isReady`, its effect still
// compiles without complaint, and the texture it hands the material is simply
// empty — a terrain that renders solid black with nothing wrong anywhere the
// eye can reach. Babylon splits optional capability into a tree-shakable half
// and a half that registers with the scene; both halves are load-bearing.
import '@babylonjs/core/Materials/Textures/Procedurals/proceduralTextureSceneComponent';
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

// <b>Every uniform is a vec4, and that is not tidiness.</b> A vec3 aligns to
// sixteen bytes in a WGSL uniform block but Babylon packs its uniform buffer
// by declaration order, so a vec2 followed by a vec3 lands the vec3's fields
// in the wrong slots. Here that made the feet-per-repeat read as zero, the UVs
// divide to infinity, and every sample come back black — from a shader that
// compiled without a word of complaint.
uniform sizing: vec4f;   // extentX, extentY, feetA, feetB
uniform reach: vec4f;    // feetC, wearLo, wearHi, unused
uniform tintA: vec4f;
uniform tintB: vec4f;
uniform tintC: vec4f;
// The sward's own colour, and how much of the ground it covers where it grows.
uniform sward: vec4f;
// <b>Nought bakes colour, one bakes the surface normal, two bakes occlusion,
// roughness and metalness.</b> One shader for all three, because the blend is
// the same question every time — how worn is the ground here, and therefore
// which of three scans is it made of — and three shaders would be three places
// for that answer to drift apart. What changes is only what happens after the
// blend: a tint and a sward overlay belong to colour and to nothing else.
uniform bakeWhat: vec4f;

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
  let toVerge = smoothstep(uniforms.reach.y, uniforms.reach.z, wear);
  let toTrack = smoothstep(uniforms.reach.z, 0.92, wear);
  let wA = 1.0 - toVerge;
  let wB = toVerge * (1.0 - toTrack);
  let wC = toTrack;

  // Repeats per axis, from feet-per-repeat and the board's real extent — a
  // single scalar would stretch the material on a board that is not square.
  let world = uv * uniforms.sizing.xy;
  let rA = shuffled(layerA, layerASampler, world / (uniforms.sizing.z * 2.0));
  let rB = shuffled(layerB, layerBSampler, world / (uniforms.sizing.w * 2.0));
  let rC = shuffled(layerC, layerCSampler, world / (uniforms.reach.x * 2.0));

  // <b>Untinted, for the two bakes that are not colour.</b> A tint is a
  // statement about what this dirt looks like; multiplying it into a normal
  // rotates the surface and multiplying it into a roughness makes the road
  // shinier than the verge for no reason at all.
  let blended = rA * wA + rB * wB + rC * wC;

  var color = rA * uniforms.tintA.rgb * wA
    + rB * uniforms.tintB.rgb * wB
    + rC * uniforms.tintC.rgb * wC;

  // The slow field across the board, so a tiling material stops reading as one
  // material. Small, and multiplicative, so it cannot invent a colour.
  color = color * (0.88 + 0.24 * drift);

  // Wet ground is darker and less varied — water fills the pores, so the
  // scattering that lightens dry dirt stops happening.
  color = mix(color, color * 0.55, wet * 0.8);

  // <b>Where the meadow grows, the ground is mostly not ground.</b> It is the
  // underside of a sward seen between blades, and it has to be the colour the
  // plants standing in it are. Without this the edge of the sown window is a
  // line on the horizon between two different greens — the geometry stops and
  // bare photographed dirt begins — which is the one place a camera-following
  // window gives itself away.
  //
  // <p>Driven by the same wear that decides whether a plant grows there at all,
  // so the road keeps its bare track and its verge without a second mask.
  let covered = (1.0 - smoothstep(0.40, 0.82, wear)) * uniforms.sward.w;
  color = mix(color, uniforms.sward.rgb * (0.86 + 0.28 * drift), covered);

  // A normal has to come back out of the texture's nought-to-one range, be
  // blended as a direction, and go back in. Averaging three scans' encoded
  // bytes and calling it a normal gives something shorter than unit length,
  // which reads as a flattened surface exactly where two layers meet — the
  // verge, which is the one place on this board anybody looks closely.
  let asNormal = normalize(blended * 2.0 - 1.0) * 0.5 + 0.5;
  fragmentOutputs.color = vec4f(
    select(select(color, blended, uniforms.bakeWhat.x > 1.5), asNormal,
      abs(uniforms.bakeWhat.x - 1.0) < 0.5),
    1.0);
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

  // <b>Three sets of scans, and two of them are data.</b> The `gammaSpace`
  // flags below are belt and braces rather than a fix: nothing decodes a
  // texture on load unless it was created with `useSRGBBuffer`, which none of
  // these are, and the bake shader reads raw texels either way. They are set
  // because the flag is what a later reader will look at to answer "is this a
  // photograph or a number", and because the one time this project got that
  // question wrong it spent a week believing the black leaves were shadows.
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
  // The board's own relief, and its own gloss. Both were on disk and unread:
  // the ground was one flat albedo at a fixed roughness, which is why a road
  // with ruts in it read as a brown stripe painted on a plane.
  const relief = bake('groundRelief', normals, 1);
  const surface = bake('groundSurface', arms, 2);

  // Not all the way to the plants' colour: some earth shows between blades even
  // in a thick sward, and a ground that matched them exactly would read as a
  // painted plane under a field rather than as the floor of one.
  const sward = swardColor();
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
    made.setVector4('sward', new Vector4(sward[0], sward[1], sward[2], 0.72));
  }

  // <b>Bake once every source has arrived, and poll for it.</b>
  //
  // <p>`refreshRate = 0` means "render once", and once is the first frame —
  // which is before three JPEGs have come off the network. It bakes black and
  // never renders again: a board that is green when the images happen to be in
  // the browser cache and pitch black when they are not, with every diagnostic
  // saying it is fine. `isReady()` is true, the effect compiles without a word,
  // the texture is in `scene.proceduralTextures`, and it reads back as 8.6 MB
  // of zeros — alpha included, from a shader that writes alpha 1.
  //
  // <p>`Texture.WhenAllReady` looks like the answer and is not: it waits on
  // load observables, and the field is a `RawTexture` built from an array that
  // never loads anything and so never fires one. The callback simply never
  // came. Polling `isReady` is duller and cannot miss.
  const every = [...sources, ...normals, ...arms];
  const ready = scene.onBeforeRenderObservable.add(() => {
    if (!every.every(texture => texture.isReady())) {
      return;
    }
    // Reset the counter rather than calling `render()`. On WebGPU the commands
    // go into the frame's encoder, so a render started outside
    // `beginFrame`/`endFrame` is never submitted; letting the scene draw it on
    // its own next frame is the difference between a bake and nothing at all.
    macro.resetRefreshCounter();
    relief.resetRefreshCounter();
    surface.resetRefreshCounter();
    scene.onBeforeRenderObservable.remove(ready);
  });

  return { macro, relief, surface, sources: every };
}

export { BAKE_TEXELS_PER_HALF_FOOT };
