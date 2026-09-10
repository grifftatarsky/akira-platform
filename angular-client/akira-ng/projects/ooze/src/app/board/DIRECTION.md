# What this renderer should be

The previous version of this document asked whether what we had was good
enough, and answered yes. That was the wrong question, and it produced a
document full of reasons not to do things.

This one asks what is best. It is written after measuring the board properly
for the first time, which changed the answer to almost every question in it.

Verdicts first:

| Question | Answer |
|---|---|
| What is actually slow? | **The terrain shader.** 93 ms to cover the screen. Everything else is a rounding error next to it. |
| Is the grass the problem? | No. 19 ms, and the most finished thing on the board. |
| Why do the coast, wood and pass look worse? | Same reason. Less grass hiding the terrain shader. |
| What is the fix? | **Stop shading terrain per pixel per frame.** Cache it into a texture, sample it once. |
| Which engine is best for that? | **three.js `WebGPURenderer` + TSL.** Chosen for the shader authoring model, not for what we already have. |
| Was `onBeforeCompile` a mistake? | Yes. Not mainly for maintainability — because it hid what the shader cost. |

---

## 1. The measurement

Everything below rests on this table, so here is how it was taken. The frame
rate counter cannot answer any of these questions: it is one number for the
whole frame, and in a pane that is not compositing it reads zero. These come
from `EXT_disjoint_timer_query_webgl2` — the GPU reporting its own elapsed
nanoseconds per draw — via `BoardRenderer.probeCost()`, which is in the repo so
the numbers can be taken again.

Road board, whole board in view, 1404 × 726, Apple M5, 12.1 M triangles,
118 draws, meadow at 1×:

| What was drawn | ms | as a frame rate |
|---|---:|---:|
| Everything, effects on | 33.8 | 30 fps |
| Everything, effects off | 29.5 | 34 fps |
| Grass alone — 830 k plants, no ground | 18.6 | 54 fps |
| Grass + a ground with a stock material | 20.8 | 48 fps |
| **Ground alone, our splat shader** | **93.5** | **11 fps** |
| Ground alone, stock material | 28.0 | 36 fps |
| Ground alone, quarter resolution | 8.3 | — |
| Re-rendering the shadow map | 0.0 | already cached |
| Bloom | 11.5 | — |

Three things fall out of it.

### The terrain is one 1,056,000-triangle mesh in one draw call

No chunking, no LOD, one bounding sphere over the whole board — so frustum
culling can never remove any of it, at any camera angle. That is indefensible
on its own terms, and it is *not* the reason it is slow.

### It is fill-bound, not geometry-bound

Quarter the pixels and it costs 8.3 ms instead of 93.5 — an eleven-fold drop
for a four-fold cut, because the texture cache starts working again too. The
triangles are nearly free. The fragment shader is the whole cost: fifty
samplers, stochastic triangle-grid tiling at three taps per layer, two
`textureGrad` scale bands, evaluated at every pixel of every frame.

### The grass has been hiding it, and I had the mechanism wrong

Ground alone is 93.5 ms. Ground *plus* 830,000 plants is 29.5 ms. Adding
geometry made the frame three times faster.

My first explanation was early-Z: grass draws first, writes depth, the ground's
expensive shader gets rejected. That is testable, and it is wrong — forcing the
ground to draw *first* with `renderOrder = -10` changed nothing at all
(29.8 ms against 30.2 ms).

The real mechanism is that this is an Apple GPU. Tile-based deferred renderers
do hidden-surface removal after binning all the geometry, so occluded fragments
are discarded **whether or not the occluder was drawn first**. That is exactly
the signature we measured, and it is why draw order was irrelevant.

Which matters far beyond the curiosity, because it means:

- **The saving is hardware we do not control.** Most Windows and Android GPUs
  are immediate-mode and get none of it. The road board is very likely much
  worse than 25 fps on a mid-range PC, and we have never looked.
- **Any view with less grass in it pays the full 93 ms.** A low camera angle. A
  cliff face. Snow. Sand. The coast, the wood and the pass are not three maps
  that need art attention — they are three maps that took the terrain shader's
  bill without the meadow to cover it.
- The grass is subsidising the terrain, and grass is the thing we were about to
  cut.

---

## 2. What best actually looks like

Four changes, in the order of what they are worth. None of them is tuning.

### 2.1 Cache the terrain shading — a runtime virtual texture

**This is the one that matters.** The splat blend is being recomputed for every
pixel, sixty times a second, and it produces the same answer every time. Nothing
about it changes between frames except which part of it you can see.

So compute it once, into a texture, and sample the texture. This is what Unreal
calls a Runtime Virtual Texture and what every large-terrain renderer since
*Rage* has done in some form: a sparse cache of pages, baked on demand at the
resolution the camera needs, invalidated only when the ground itself changes.
The terrain fragment shader stops being fifty samplers and becomes one.

- 93 ms becomes low single digits, and stops scaling with layer count. We can
  afford eight ground materials where today we ration four.
- It is **the same mechanism a user-drawn terrain needs.** Painting a layer
  dirties the pages under the brush and re-bakes them; nothing else in the frame
  knows anything happened. Without it, every brush stroke re-evaluates the whole
  splat shader forever afterwards.
- It removes the reason the ground is one giant mesh, because the shading no
  longer has to be continuous across it.

### 2.2 Chunk and LOD the terrain mesh

Once fill is fixed, 1.06 M unculled triangles becomes the next ceiling. Chunks
with per-chunk bounds and a distance-selected index buffer. Unremarkable work,
and it is prerequisite for editing anyway — a terrain you can draw on is one you
must be able to rebuild in pieces.

### 2.3 Put the plants on the GPU

830,000 instance matrices are composed in JavaScript at load and re-uploaded
whenever anything changes. That is why the density slider stutters and why a
terrain edit would rebuild the world.

The modern form, which is what *Ghost of Tsushima* does: a compute pass reads a
density map and a clump map, generates blades for visible tiles, culls them
against the frustum and the depth pyramid, appends survivors to a buffer, and an
indirect draw renders exactly what it produced. Nothing crosses back to the CPU.
Density becomes a uniform — the slider stops being a rebuild and becomes a
number.

### 2.4 Three bands, not one

Every game that does this well draws grass three ways at once: geometry near,
cross-quads or cards in the middle, and nothing at all far away, where the
terrain texture is simply painted to look like grass. We have one band —
geometry, everywhere, out to the horizon.

The far band is free once the terrain is virtually textured, because "paint the
ground to look like grass" is a layer in the bake.

*Ghost of Tsushima* has one more trick worth stealing outright: grass does not
cast real shadows. The terrain vertices are raised to grass height and depth is
written in a dithered pattern. We currently render 830,000 plants into a 4096²
shadow map — cached today, but it must be re-rendered every time the sun moves.

### 2.5 Turn off bloom outdoors

11.5 ms — a third of the frame — on a daylight board where the threshold is set
high enough that almost nothing crosses it. Bloom earns its cost in a torchlit
dungeon. Outdoors it is buying a faint haze for a third of the frame budget.

---

## 3. The engine

### The honest framing

Moving to WebGPU means rewriting every shader we have, because TSL is a node
graph and WGSL is not GLSL. That is true of *any* destination. So the shader
rewrite is not a cost of changing engines — it is a cost of the four changes
above, and we pay it whichever library we land on.

Which means the engine should be chosen on merit alone. The previous version of
this document did not do that; it counted work already done as a reason, which
is not a reason.

### What the four changes actually demand

1. Compute shaders, storage buffers and indirect draw. (2.3)
2. Render-to-texture into an atlas, driven by a feedback pass. (2.1)
3. A way to extend a PBR material that does not hide its cost. (all of it)
4. Cascaded shadows, temporal AA, ambient occlusion.
5. Fits in an Angular micro-frontend as a lazy ES module, with no mandatory
   editor or asset pipeline.

Note what is *not* on the list: nothing off the shelf renders a virtually
textured, user-paintable terrain under a million compute-generated blades. No
engine gives us 2.1 or 2.3. Both of the serious candidates give us PBR, shadows,
glTF and post. So the decision turns almost entirely on point 3 — which one
makes the custom work least painful, because the custom work is the project.

### The candidates

**three.js `WebGPURenderer` + TSL.** Production-ready since r171; every major
browser ships WebGPU now, Safari included. `StorageBufferAttribute` and
`IndirectStorageBufferAttribute` are in core, so 2.3 is directly expressible.
The decisive property is TSL itself: shaders are **typed TypeScript that
compiles to WGSL or GLSL from one source**. Our light field, wind, blade
widening and splat sampler generation stop being strings spliced into someone
else's chunks and become composable functions we can name, reuse and unit test.
Compute is written in the same language as shading.

**Babylon.js 8.** The stronger *engine*: `CascadedShadowGenerator`, a TAA
pipeline, SSAO2 and MSAA in core rather than in `examples/jsm`; compute shaders
and storage buffers that are first class; a scene Inspector that would have told
me the terrain cost 93 ms without my writing a timer-query harness to find out.
Genuinely batteries-included in a way three is not.

Against it, precisely on the axis that matters most here: `MaterialPluginBase`
is still **string injection**. Better string injection than `onBeforeCompile` —
named hook points, managed defines, a supported API rather than regex surgery —
but strings, and on WebGPU you author them twice, once in GLSL and once in WGSL,
unless you drop the WebGL path entirely. For a project that is roughly
four-fifths custom shading, that is the wrong end of the trade.

**PlayCanvas.** Excellent engine, good WebGPU support, and its material
extension model is chunk-string overrides — the same trap we are climbing out
of. The editor is the product. No.

**Raw WebGPU.** The highest ceiling, and for terrain and vegetation we end up
writing most of it regardless. But we would also be writing shadow mapping, PBR,
glTF import, picking and post — months of work with nothing to do with D&D. No.

**Unity / Unreal / Bevy to the web.** Tens of megabytes, they take over the
page, and they put a game engine between the rules engine and its picture. This
is a compendium with a board attached. No.

### Verdict

**three.js `WebGPURenderer` + TSL.**

Not because we are already on three — that argument is void, and the shader
rewrite happens either way. Because the four things worth building are all
custom shading and custom compute, and TSL is the only mainstream option where
those are written once, in typed code, in one language, instead of as strings.
It is the direct fix for the thing that made the current renderer bad.

Babylon is a legitimate choice and would win on a different project: one with
artists in an editor, more stock materials, more physics, less custom shading.
That is not this one. If we did pick it, we should go WGSL-only and give up the
WebGL fallback, or we would author every shader twice.

---

## 4. What carries over

Nothing in the *look* is lost by moving, which is worth saying plainly because
it is the part that took judgement rather than typing:

- **Translucency.** Grass lit from behind glows. `(-N·L)·(E·L)·thickness`, from
  GPU Gems 3. Ten lines in any language.
- **Voronoi clumping.** Real fields are clumpy, not evenly random. The clump
  decides height, lean and tone; the plant keeps a little of its own.
- **The species model.** Strips with `reach`, `leaf`, `band`, `notch`; the
  clover's notched tip and crescent band are shapes, not gradients, which is why
  the ramp version read as a smear.
- **The real sun.** Declination, hour angle, air mass; colour and intensity from
  one number so there is no such thing as a bright blue sunset.
- **Eye adaptation to luminance rather than illumination** — the bug that made
  snow a white void.
- **The half-foot world unit**, and every default in it. GTAO's radius is four
  half-feet because that is the scale of the crease where a crate meets a floor.

All of it is arithmetic. It ports.

---

## 5. Build order

1. **Look at a non-Apple GPU first.** Every number here was taken on hardware
   that removes hidden fragments for free. We do not know what this board costs
   on an immediate-mode GPU and it is probably much worse. One measurement.
2. **Turn bloom off outdoors.** A third of the frame, today, no rewrite.
3. **The virtual terrain texture.** The 93 ms, and the thing user-painted
   terrain needs anyway. Prototype it on WebGL2 if it is faster to learn that
   way; the design is what matters.
4. **Move to `WebGPURenderer` + TSL**, porting the light field, splat, meadow
   and water as TSL nodes.
5. **Compute-driven scatter with indirect draw**, which makes the density slider
   a uniform.
6. **Chunk and LOD the terrain mesh**, then the far band that is not geometry.
7. **TAA**, which is the correct answer to grass shimmer and is on the table
   once there are motion vectors.

The first three are worth doing whether or not we ever change engine, and the
third is most of the win.
