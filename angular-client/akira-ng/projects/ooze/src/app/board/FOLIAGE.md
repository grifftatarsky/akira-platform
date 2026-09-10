# The meadow: what is wrong with it and what to do

Ten passes of research, each one written down before the next started and each
one told to attack what the last concluded. The log of all ten is at the bottom,
because a report that shows only its final answer hides the two useful things:
which ideas did not survive, and why.

**Nothing here has been verified against this renderer.** Dive 10's whole finding
is that the other nine produced confident causal claims and measured none of
them, so the plan below is ordered by *how cheap each item is to falsify*, and
the first item is a measurement rather than a fix.

---

## The two complaints

**"It's shadows dude. It's shadows."** The meadow sets `receiveShadows = true`
and reads a shadow map that contains only terrain — but dive 10 found a second
explanation that produces an identical picture, and I cannot tell them apart from
a screenshot.

**"Your geometry is still weird, it's like your stuff has negative space and bad
shapes."** Correct, and it is a different problem than the one I have been
solving. I have been fixing *botany*; the complaint is about **silhouette
occupancy** — the shapes have holes, and the holes are where the eye lands.

---

## The order of work

Ordered by cost-to-falsify. Everything above the line is a single property or a
single number.

### Tier 0 — measurement, before anything

1. **Split the GPU timer per pass.** Field, terrain, shadow, sky, post. One
   aggregate number has produced ten dives of speculation.
2. **Render flat-lit with the terrain hidden.** Separates "acne on blades" from
   "shadowed ground through gaps in the sward" in one frame. Everything in the
   shadow section branches on this.

### Tier 1 — one line each, all falsifiable in a minute

3. **`leaf.gammaSpace = false`.** If the species colours are linear and Babylon
   is treating them as sRGB, the roots are 8.5× too dark and the tips 1.8×,
   which is a black-at-the-base curve applied on top of the one I author. Either
   the whole answer or nothing (dive 8).
4. **`TONEMAPPING_KHR_PBR_NEUTRAL`** instead of ACES, whose documented failure is
   hue skew and washed highlights on green (dive 5).
5. **`meadow.receiveShadows = false`** — the Fortnite/HDRP configuration.
   Removes a texture fetch and a PCF loop from the hottest shader in the frame
   (dives 1, 6).
6. **A third directional light: the bounce.** Sun's horizontal direction negated
   and flattened to the horizon, warm `(0.40, 0.28, 0.20)`. The cheapest item in
   this report and it is aimed straight at black shadow sides (dive 5).
7. **`scene.fogMode = FOGMODE_EXP2`**, colour from the sky at the horizon. The
   cheapest depth cue that exists, and the board has none (dives 5, 8).
8. **`roughness` 0.78 → ~0.55, `specularIntensity` 0.25 → ~1.0.** Grass is shiny;
   suppressing that removes the single thing that most says "grass in sun"
   (dives 2, 4).
9. **`freezeShadowCastersBoundingInfo = true`** — the terrain never moves.

### Tier 2 — small, contained, high value

10. **Distance culling and a density ramp in the compute pass.** `meadow.ts`
    culls *nothing*: no frustum test, no distance falloff, no LOD. Comparable
    browser renderers do a million blades in 2–3ms; this does 330,000 in 35
    (dive 7).
11. **Widen the blades and thin them.** One knob that fixes negative space, quad
    overdraw and distance aliasing at once — a thin triangle costs four
    fragments to shade one (dives 2, 3, 7).
12. **Take the normal from the ground.** Breath of the Wild and Black Ops 4 both
    do it. Replaces `LEAF_LIFT`, `LEAF_FLOOR` and the wind plugin's `lit.y`
    clamp with one rule that cannot produce a ground-facing normal (dive 3).
13. **The Frostbite translucency term**, reading the thickness `leaf-texture.ts`
    already bakes into alpha and currently throws away (dive 4).
14. **Sky as IBL.** A `ReflectionProbe` on the sky box replaces the hemispheric
    light and the hand-fitted `dusk` curve, so the thing lighting the scene is
    the thing the scene is standing under. Babylon computes IBL irradiance in the
    vertex shader, so this is not a per-fragment cost (dives 5, 6).
15. **Fill the silhouettes.** Mass first, then lobes, then leaves — the opposite
    of the order I have been building in. Cross-quads for the panicle;
    view-space thickening so an edge-on blade does not vanish; blade folding
    (dives 2, 3).

### Tier 3 — real features, not fixes

16. `IblShadowsRenderPipeline`'s screen-space shadow component — contact shadows
    for grass, in the box (dive 9).
17. A LOD ladder with stochastic dithered cross-fade, and a far band that is
    terrain material rather than geometry (dive 7).
18. Blue-noise placement, and a coverage blend between grass colour and ground
    colour (dive 10).
19. Frame graph: z-prepass, TAA (dive 9).

---

## What the ten dives changed about my mind

- **Thin blades are the most expensive shape, not the cheapest.** Widening them
  is the performance fix, not a trade against it. I had this exactly backwards.
- **Alpha would make it worse.** Dive 1 wanted to close holes with texture;
  every source says close them with geometry and keep opacity out of it.
- **Triangles are not the problem.** 1.2M triangles at 27fps against 8.2M at
  120fps elsewhere. It is fragments, and it is culling.
- **The normals should come from the ground**, not from a hand-tuned fan — and
  that same change makes shadow bias inoperable, which is why the two have to be
  decided together.
- **The sky, the ambient and the environment are three unrelated opinions** about
  what colour the sky is. That is why evening never looks right no matter how
  many times I retune the curve.
- **Grass is shiny and anisotropic**, and I explicitly turned that off.
- **I have measured none of this.**

---

## Tier 2, measured — and the report's central premise is wrong

Tier 2 was attempted and **most of it does not apply to this renderer**. The
evidence is three numbers, taken at 100% density on the road board at radius 150.

| Change | GPU |
|---|---|
| Baseline | 19.6 ms |
| Render at **half** the pixels | 17.4 ms |
| Render at **a quarter** of the pixels | 16.5 ms |
| **Half** the plants, full resolution | **10.6 ms** |
| **A quarter** of the plants, full resolution | **6.6 ms** |

Quartering the pixels saves 16%. Halving the plants saves 46%. **The meadow is
not fragment-bound.** It scales with instance count and barely with resolution,
which means the cost is per-instance and per-triangle work — vertex shading,
instance fetch and primitive setup on a million sub-pixel triangles — not
shading.

That contradicts the loudest conclusion in this whole report. Dives 2, 3 and 7
agreed, from four independent sources, that thin blades are expensive because a
GPU shades in 2×2 quads and throws three fragments away. That is true in
general and it is not what is happening here. **Two hundred searches of other
people's engines lost to one afternoon of measuring this one.**

Three things follow, and they invalidate the Tier 2 plan as written:

1. **Culling in the vertex shader cannot work.** I built it — collapse a culled
   plant's vertices onto a point so its triangles have no area. It compiled, it
   ran, it culled correctly, and it saved **nothing at all** (25.2 ms against
   25.6). Of course it did: a degenerate triangle still costs a vertex shader
   invocation and a primitive setup, and that is the whole bill. It has been
   reverted rather than shipped.
2. **Thinning while widening to keep coverage is neutral by construction.** If
   the same ground is covered, the same pixels are shaded. The saving in the
   literature comes from reduced overdraw, and overdraw is not the cost here.
3. **The only lever is drawing fewer instances**, which means real compaction:
   the compute pass writes survivors to the front of the buffer with an atomic
   counter and the draw takes its instance count from the GPU. Babylon supports
   `draw_indirect` on WebGPU. That is the actual Tier 2, and it is a bigger
   piece of work than a batch of settings.

### What the harness learned, which cost more than the finding

Four hours went into instruments rather than the renderer, and all four
failures were silent:

- **A WGSL shader that fails validation does not throw.** Mixing `*` and `^`
  without parentheses is a parse error; Babylon reports nothing, the material
  still answers `isReady()`, the pipeline is quietly invalid and the meadow
  draws nothing. The GPU timer then reads 3 ms instead of 26, which looks
  exactly like a triumph. `tools/chrome-probe.mjs` now collects the browser
  console, which would have said so in the first minute.
- **`camera.getForwardRay()` needs a side-effect import.** With deep imports it
  throws every frame inside the render loop, so the board renders zero frames
  while `requestAnimationFrame` keeps firing at 120 Hz. Use `getDirection`.
- **Chrome stops `requestAnimationFrame` for an occluded window**, and Babylon's
  render loop is `requestAnimationFrame`. A Chrome behind a terminal reports a
  healthy fps from its last live second and a stale camera. The probe now sets
  `Emulation.setFocusEmulationEnabled`.
- **`Page.captureScreenshot` cannot see a WebGPU canvas** from an occluded
  window, with or without `fromSurface`. `tools/board-shot.mjs` renders the
  scene into a `RenderTargetTexture` and reads the pixels back instead, which
  never touches the compositor.
- And, for the fourth time in this project, **a backtick inside a WGSL comment
  closes the template literal.**

---

## Dive log

**Dive 1 — shadows and the Tsushima baseline.** Established that no shipping
game shadow-maps grass, and that the fix is subtractive rather than additive.
Established that the geometry complaint is about silhouette occupancy, which is
a different axis from the botanical accuracy I had been working on.

**Dive 2 — shadow literature, and the shading/perf literature underneath it.**
Two findings that changed the plan rather than adding to it.

*Thin blades are not cheap, they are the most expensive shape there is.* A GPU
shades in 2×2 quads. A triangle that covers one pixel of a quad still costs four
([Counting Quads](https://blog.selfshadow.com/2012/11/12/counting-quads/),
[Unreal Art Optimization](https://unrealartoptimization.github.io/book/pipelines/pixel/)).
My grass is a 9:1 spindle whose triangles are one to two pixels wide at any real
distance, so somewhere near three quarters of the meadow's fragment work is
being thrown away. **Widening the blades is not a trade against performance. It
is the performance fix.** The silhouette complaint and the 35ms frame are the
same bug, which I did not expect and would not have guessed.

*Alpha would make it worse, not better.* Dive 1 wanted to close the panicle's
holes with alpha in the leaf texture. Every source says the opposite:
[Nils Arenz's UE4 grass](https://80.lv/articles/creating-next-gen-grass-in-ue4)
models each blade specifically to keep opacity usage as low as possible *because*
that is what lowers quad overdraw, and a comparison of twenty grass assets found
one triangle per blade with no opacity mask to be the fastest of all of them.
Tsushima's own note is "no transparency = no overdraw". **Dive 1's alpha plan is
withdrawn.** Close the holes with geometry that is wider, not with texture that
is emptier.

Three techniques I did not have:

- **View-space thickening** (Tsushima): a blade turned edge-on has its vertices
  pushed toward the camera so it keeps a readable width instead of vanishing.
  This is the exact cure for negative space, in the vertex shader, for free.
- **Blade folding** (Tsushima): short blades fold into a dual-blade shape,
  doubling apparent density at no geometric cost.
- **Vertex-alpha ambient occlusion** (Crysis, [GPU Gems 3 ch. 16](https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-16-vegetation-procedural-animation-and-shading-crysis)):
  AO painted into vertex alpha and multiplied into diffuse. This is the honest
  replacement for the shadow map the grass should not be reading.

And one thing I have simply wrong. [hexaquo's theory piece](https://hexaquo.at/pages/grass-rendering-series-part-1-theory/)
opens by saying grass is *shiny* — individual blades throw hard specular
highlights, and the field's glitter is those highlights at random orientations.
`meadow.ts` sets `specularIntensity = 0.25`. That is a deliberate suppression of
the single feature that most says "grass" in sunlight.

Crysis's subsurface term is also cheaper than the one I am running: `saturate(-N·L) * saturate(E·L) * thickness`,
per vertex, against Babylon's full `subSurface.isTranslucencyEnabled` per pixel.

**Dive 3 — geometry, silhouette, and the botany.** The negative-space complaint
turns out to have a name and a well-worn answer, and it is not a modelling
answer.

*Foliage reads as mass, then lobes, then leaves — in that order.* The painting
literature is unanimous and blunt about it: visualise the plant as basic solids
— spheres, cones, ellipsoids — each with a lit side and a shadowed side, because
**those big shapes are the read**; only then break the volume into secondary
lobes, and only at the focal edge do you draw a leaf
([Sunstrike](https://sunstrikestudios.com/en/blog/realistic_foliage_painting/),
[Rocketbrush](https://rocketbrush.com/blog/guide-working-with-foliage)). Every
plant I have built is the opposite order: leaves first, and no mass at all. That
is precisely what "negative space and bad shapes" describes. Angelo Pesce, on
Black Ops 4's grass, puts the engineering version of the same sentence:
**geometry exists for coverage and silhouette, not for shading**
([c0de517e](https://c0de517e.com/017_vegetation_part2.htm)). I have been
spending vertices on botanical correctness and getting no coverage.

*The normals should come from the ground.* Two entirely independent sources say
so. Breath of the Wild copies the terrain's normal onto its grass strands
([Polycount](https://polycount.com/discussion/209623/smooth-foliage-like-in-breath-of-the-wild-europa-by-helder-pinto-mini-tutorial)),
and Black Ops 4 rotates blade normals by the terrain normal and reverts to pure
terrain normals at distance. The general form is the **bent-hemisphere transfer**
— wrap the plant in an ellipsoid and take its normals — which is the standard
foliage trick and which `pushNormal` is a poor hand-rolled approximation of.
This replaces `LEAF_LIFT`, `LEAF_FLOOR` and the `lit.y = max(lit.y, 0.22)` clamp
in `blade-wind.ts` with one principled rule, and it cannot produce a
ground-facing normal by construction.

*Triangles are not the problem, and the numbers are not close.* A browser grass
renderer holds **8.2 million triangles at 120fps on an M2 MacBook**
([Gjoreski](https://aleksandargjoreski.dev/blog/growing-my-grass-shader/)); a
three.js field does 1.5M blades in 3ms of GPU. I am at **1.2 million triangles
and 27fps**. His conclusion, arrived at independently of dive 2's quad-overdraw
finding: the question is not how many triangles, it is *how many times am I
shading the same pixel*. Two dives, two routes, one answer.

*Translucency is why the field looks dark.* "Without it, the grass looks way too
dark, even with GI" — and the cheap version is not Babylon's per-pixel
`subSurface`: flip the normal where the surface faces away from the sun and push
albedo saturation up. Pesce also reports that a **height ramp acting as ambient
occlusion** was "surprisingly powerful" for perceived detail, which is the same
conclusion as dive 1 reached from the other end.

*Grass is anisotropic, not just shiny.* Dive 2 caught `specularIntensity = 0.25`
suppressing the highlight. Dive 3 says the highlight should also be **stretched
along the blade** — grass is strands, and strands are anisotropic. Babylon's
`PBRMaterial` has `anisotropy` in the box with a tangent angle, so this is a
setting rather than a shader.

*The botany, corrected.* Working from floras rather than memory:

| Plant | What the books say | What I built |
|---|---|---|
| White clover | Leaflets **obcordate** — widest above the middle, inverted heart, 6–12mm — with a **whitish V watermark** near the centre, the single most identifying mark | Shape now right; the watermark is missing entirely, and it is texture, so it is nearly free |
| Ribwort plantain | Leaves 10–15cm × 2–3.5cm, so about **5:1**, and "longer and **more upright** in meadows and grasslands" — flat only in short turf | 8:1 and splayed at 36°: a lawn plantain, not a meadow one |
| Oxeye daisy | Basal leaves **spoon-shaped/obovate**, coarsely toothed; stem leaves smaller and stalkless going up | Two plain slivers at the base |
| Yorkshire fog | Panicle 10–20cm, **pink or purplish**, soft; whole plant velvety | Panicle is greyish-cream and a third too short |

*The lie I should keep.* A real grass blade is 3–12mm wide. Mine is about 52mm —
somewhere between four and seventeen times life. That is not a bug: Fortnite's
own note is that they compensate for "grass blades being somewhat larger than
reality", and Pesce names **aliasing from inadequate blade density** as a
first-order failure. Sub-pixel blades shimmer and cost four fragments each.

**Dive 4 — the foliage shading model.** Chasing dive 3's claim that translucency
is why the field looks dark, and finding the shading model is wrong in four
separate ways at once.

*The translucency formula, from the source.* Barré-Brisebois and Bouchard's
Frostbite approximation ([GDC 2011](https://colinbarrebrisebois.com/2011/03/07/gdc-2011-approximating-translucency-for-a-fast-cheap-and-convincing-subsurface-scattering-look/),
GPU Pro 2) is four lines and no per-pixel scattering:

```
transLightDir = L + N * distortion
transDot      = pow(saturate(dot(V, -transLightDir)), power) * scale
transLight    = attenuation * transDot * thickness * subsurfaceColor
```

The thickness comes from a baked map — and `leaf-texture.ts` **already writes
thickness into the alpha channel and then throws it away**. That map exists. It
is the input this formula wants, and nothing is reading it.

*Unreal's Two Sided Foliage model exists for exactly this and says why.* Its
documentation is explicit that the ordinary subsurface model "works well on skin
or thicker surfaces, but is not as accurate for thin surfaces like leaves"
([Epic](https://dev.epicgames.com/documentation/unreal-engine/shading-models-in-unreal-engine)).
Babylon's `subSurface.isTranslucencyEnabled` is the thick-surface model. I picked
the wrong one, and it is also the expensive one.

*Measured values say my material is wrong in the boring way too.* Reference
tables put tall wild grass at **albedo 0.16–0.18**, short green grass at
0.2–0.25, leaf translucency 0.1–0.3 and *yellowish*
([Torque PBR values](http://wiki.torque3d.org/artist:pbr-material-values),
[Polycount](https://polycount.com/discussion/136216/pbr-value-lists)), with
glossiness around 0.5 — so **roughness near 0.5, not the 0.78 I set**. My base
green lands in range at ~0.24 luminance; my tip colour is ~0.55, more than double
what a real blade tip reflects. Some of "why does your chrome look so bad" may
simply be a field painted too pale at the top and too rough to catch the sun.

*And the backface story is not settled after all.* `twoSidedLighting = false`
was chosen deliberately, because flipping an authored, floored normal points it
at the ground. That reasoning holds only while the normals are authored fiction.
Once dive 3's terrain-normal rule is in, **the normal is the ground's** — and
flipping it is exactly Pesce's translucency trick, not a bug. The two changes
have to land together or each makes the other look wrong, which is presumably
how I got here.

**Dive 5 — the sun, and the rest of the lighting stack.** Reading `stage.ts`
against the literature turned up something bigger than any single setting.

*Three lights disagree about what colour the sky is.* The scene has three
separate opinions and none of them is told about the others:

1. `SkyMaterial` — a real Preetham atmosphere, driven by turbidity and rayleigh,
   which moves correctly with the sun.
2. `HemisphericLight` — a hardcoded blue `(0.62, 0.72, 0.9)` over a brown
   ground `(0.28, 0.26, 0.2)`, hand-lerped toward orange by a `dusk` term I
   wrote to imitate what the sky is already computing.
3. `scene.environmentTexture` — an HDR **photograph** of some other sky, fixed,
   at some other time of day, and the only thing giving PBR any ambient
   specular at all.

The grass is lit by (2) and (3) and stands under (1). That is why evening never
looks right no matter how many times I retune the `dusk` curve: I am hand-fitting
a fake sky to a real one. **The sky should light the scene.** A `ReflectionProbe`
rendering the sky box once whenever the clock moves gives
`scene.environmentTexture` for free, and then the hemispheric light and the whole
`dusk` block can go.

*There is no bounce light, and that is what makes shadow sides black.* Íñigo
Quilez's outdoor recipe ([iquilezles.org](https://iquilezles.org/articles/outdoorslighting/))
is three directionals, and I have one:

| Light | Direction | Colour | Have it? |
|---|---|---|---|
| Key (sun) | from the sun | `(1.64, 1.27, 0.99)` | yes |
| Sky fill | straight down | `(0.16, 0.20, 0.28)`, AO applied | as a hemisphere |
| **Bounce** | **the sun's horizontal, negated, flattened to the horizon** | `(0.40, 0.28, 0.20)`, warm | **no** |

The bounce is the cheapest thing in this entire report and it is aimed exactly
at the complaint: it lights the side of every blade the sun cannot reach. Two of
his other rules also land: **do not apply AO to the key light**, and keep diffuse
albedo near 0.2 — which agrees with dive 4's measured 0.16–0.18 for wild grass
and disagrees with my 0.55 tips.

*ACES is a bad fit for a green field.* Babylon offers three tone mappers and I
picked the one whose known failure mode is exactly this content: ACES skews hue
in the highlights and desaturates, and the reported symptom is "unnatural
colours, washed-out highlights and crushed blacks, **especially in forests**"
([Godot's AgX discussion](https://github.com/godotengine/godot-proposals/discussions/7545),
[Khronos](https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products)).
Babylon ships `TONEMAPPING_KHR_PBR_NEUTRAL`, which exists to preserve hue and
saturation while still killing highlight artefacts. That is a one-line
experiment worth running before anything else in this section.

*There is no fog.* `scene.fogMode` is never set. Aerial perspective is the
cheapest depth cue in real-time rendering, the board is 220 feet across, and
every reference image of a meadow has the far end paler than the near end.
`FOGMODE_EXP2` with `fogColor` sampled from the sky at the horizon costs one
line and one lerp.

*And the sun is not a point.* Its angular diameter is **0.53°**, which is what
makes real shadow edges soften with distance from the caster. `shadowMaxZ = 400`
with `QUALITY_MEDIUM` PCF gives a fixed-width blur instead. Not urgent, but it is
why terrain shadows read as stencils.

**Dive 6 — attacking dive 1's own conclusion, and finding it half wrong.**

Dive 1 said: take grass out of the shadow system in both directions. Dive 6 went
looking for the counter-argument and found it immediately. The standard advice on
every forum is the *opposite* of half of that — **"have grass receive shadows
from other things and terrain, but not cast its own shadow"**
([GameDev.net](https://www.gamedev.net/forums/topic/423966-grass-shadows/3821626/),
[Unity](https://docs.unity3d.com/Manual/ShadowPerformance.html)). Which is
exactly the configuration in `bab-board.ts` right now. So the setup is not
eccentric; it is the textbook one, and it is producing acne anyway.

That reframes the question from *should grass receive shadows* to *why can this
particular bias not be tuned* — and dive 6 found the sourced answer, which ties
back to dive 3 in a way I did not expect.

**Normal-offset bias requires the geometric normal, and a plant does not have
one any more.** The technique offsets the shadow lookup along the surface
normal; implementations warn you need "vertex normal, not normal mapped one", and
Polycount notes directly that the dome/sphere-transferred normals used for
foliage "may not work as effectively with normal offset shadow bias algorithms
that depend on accurate geometric normals"
([Ogre](https://github.com/OGRECave/ogre-next/issues/100),
[Mr F's notes on shadow bias](https://ndotl.wordpress.com/2014/12/19/notes-on-shadow-bias/)).

Every normal in `species.ts` is deliberately fictional — fanned, lifted, floored.
`shadows.normalBias` is therefore not "untuned", it is **inoperable**, and dive 3's
terrain-normal proposal would make it *more* fictional, not less. The two ideas
collide, and the collision is the finding.

So there are three real options and they are genuinely different, not three
flavours of one:

| | What it is | Cost | What it gives up |
|---|---|---|---|
| **A. Stop receiving** | `receiveShadows = false`, replace with a height ramp and the bounce light | One line; *removes* a texture fetch and a PCF loop from the hottest shader in the frame | Grass no longer darkens under a tree or a ridge. Fortnite and HDRP both ship this |
| **B. Carry a second normal** | Add a geometric normal attribute used only for bias, keep the fictional one for shading | 12 bytes a vertex, no fragment cost, some plumbing | Nothing visual; it is the correct fix and the fiddliest |
| **C. The Tsushima imposter** | Raise the terrain's shadow proxy to grass height, write depth dithered | A second proxy pass and a dither | Most work by far; also the only one that makes the *field* cast onto the road |

**A first, because it is one line and it answers the actual complaint tonight.**
B is the right long answer. C is a separate feature, not a fix.

Two smaller things from the same dive. `freezeShadowCastersBoundingInfo = true`
is free here — the terrain never moves and it is the only caster. And
`autoCalcDepthBounds` is documented to "greatly improve shadow rendering", but
the WebGPU forum threads report flickering with it and one thread has it
interfering with camera control, so it is a try-and-look, not a fix.

One correction to dive 5 as well: Babylon computes IBL **irradiance in the vertex
shader** and interpolates it. So replacing the hemispheric light with a
sky-derived environment texture is not a per-fragment cost at all — it may be
cheaper than the light it replaces.

**Dive 7 — where the 35 milliseconds actually goes.** This dive found the
largest single fact in the report, and it is not subtle.

**`meadow.ts` culls nothing.** The word "distance" does not appear in the file.
There is no frustum test, no distance falloff, no LOD, no density ramp. Every
plant on a 220×150-foot board is dispatched, transformed and shaded every frame
regardless of whether the camera is looking at it, standing in it, or a hundred
feet above it. `alwaysSelectAsActiveMesh = true` on top of `forcedInstanceCount`
means Babylon is not even doing its own coarse pass.

Everyone else culls, in stages, before the vertex shader. Tsushima does distance,
frustum and occlusion. Helio — a **WebGPU** foliage system, so the same hardware
path this board is on — does tile culling with Hi-Z, then 4×4 cluster culling,
then per-LOD append via atomics, then four `draw_indirect` calls
([Pulsar](https://pulsarnative.com/blog/2026-08-02-helio-foliage-system)).

The comparison is not close:

| | Blades | GPU | Notes |
|---|---|---|---|
| Helio (WebGPU) | 1,000,000 | **< 3 ms** at 1080p | 4 LODs, indirect, Hi-Z |
| hexaquo (Godot) | whole terrain | **< 2 ms** | geometry near, impostor plane beyond ~10 units |
| Gjoreski (three.js) | 1,180,000 | 120 fps on an M2 | 8.2M triangles, one draw call |
| **Oozengine** | ~330,000 | **35 ms** | no culling, no LOD |

Ten to twenty times off, against browser renderers, on comparable hardware.

*The LOD ladder that everyone converges on.* Helio: 11-vertex strips to 8m,
7-vertex strips to 20m, textured cards to 45m, clump cards to 120m, terrain
material beyond. hexaquo: full geometry to 5 units, dithered cross-fade to 10,
impostor plane past 20. The transition in both is a **stochastic dither** — a
stable per-blade hash against a per-pixel per-frame threshold — which cross-fades
without popping and, in Helio's case, is deliberately keyed off tile coordinates
rather than frame state so TAA does not ghost it.

*And the far band closes the loop back to dive 2.* The rule for fading density
with distance is to **widen the blades as you thin them**, keeping coverage
constant. That is the same lever as the quad-overdraw fix: wider blades, fewer of
them, identical silhouette, a quarter of the fragment waste. Three of this
report's problems — negative space, frame time, and distance aliasing — are one
knob.

*The cheap intermediate step.* A z-prepass is the standard overdraw cure for
dense un-sortable foliage ([Interplay of Light](https://interplayoflight.wordpress.com/2020/12/21/to-z-prepass-or-not-to-z-prepass/)),
and its usual objection — double draw submission on the CPU — does not apply
here, because the meadow is five draws, not five thousand. Babylon has a depth
renderer already imported in `stage.ts`.

*Babylon does support the endgame.* `draw_indirect` works on its WebGPU backend
([forum sample](https://forum.babylonjs.com/t/indirect-drawing-sample-using-wgsl/63571)),
so a compute pass can write the instance count per LOD and the CPU never learns
how much grass there is. That is the same architecture as Helio, available today,
and it is a much smaller step from `forcedInstanceCount` than it sounds.

**Dive 8 — colour space, exposure, and the tonal structure.** This dive found a
bug I would never have found by looking at the screen, because it looks like a
lighting problem and it is arithmetic.

**The plant colours may be going through the sRGB transfer function twice.**
`leaf-texture.ts` is a `ProceduralTexture` handed to `material.albedoTexture`,
and **`gammaSpace` is never set on it**. Babylon defaults every colour texture
to gamma-encoded and applies an sRGB→linear conversion in the PBR shader
([Babylon on colour space](https://doc.babylonjs.com/preparingArtForBabylon/controllingColorSpace/),
[the forum thread](https://forum.babylonjs.com/t/pbr-and-the-gamma-correction-of-textures/1083)).
The shader writes `mix(base.rgb, tip.rgb, …)` straight from the species table,
and those numbers read as linear albedo — grass base `(0.13, 0.30, 0.08)`, whose
luminance is 0.25, which is exactly the measured figure for short green grass
that dive 4 turned up.

If they are linear and Babylon is treating them as sRGB, then:

| Authored | What the shader gets | Factor |
|---|---|---|
| base 0.13 | 0.015 | **8.5× darker** |
| tip 0.63 | 0.355 | 1.8× darker |
| bloom 0.95 | 0.891 | 1.07× darker |

Note the shape of that. The conversion is not a dimmer — it is a **curve**, and
it crushes the roots eight times harder than the tips. A root-to-tip ramp I
already apply in the wind plugin, multiplied by a second hidden ramp that is far
steeper. That is a black-at-the-base signature, and it is present with the sun
off, with shadows off, and with every normal pointing at the sky. **Test this
first: it is one property and it is either the whole answer or it is nothing.**

The same question applies to `splat-bake.ts` and to every `Color3` set from a
literal — Babylon's own guidance is that colours from a picker are sRGB and must
have `.toLinearSpace()` applied before they reach `albedoColor`.

*The tonal structure is compressed, and there is a name for that too.* The
landscape-painting rule is that a flat image comes from a compressed tonal range,
and that **the foreground should hold the darkest darks and the lightest lights
while the distance goes to mid-tones** — which is aerial perspective again, from
the other direction. The board has no fog, and the far end of a 220-foot field is
rendered at exactly the same contrast as the near end. The screenshot shows this
plainly: the far hill and the near grass are the same value.

*Exposure is being asked to do a job it cannot do.* `stage.ts` sets exposure from
`pow(eyeExposure(elevation), 0.45)` — a hand-fitted curve on top of an
already-approximate model, feeding ACES, which then skews the greens (dive 5).
The reference frame everyone else uses is EV100: direct sun is **EV100 = 15**,
and auto-exposure ranges run about −8 to +18. Nothing in this scene is in those
units, so there is no way to check whether the answer is right — which is
probably why it has been retuned by eye four times.

**Dive 9 — what Babylon 9.26 already ships that I am hand-rolling.** The
standing instruction on this project is to use as much out of the box as
possible. Four of the things this report has been proposing to build are already
in the box.

*Screen-space shadows are in Babylon, today.* The `IblShadowsRenderPipeline`
(Babylon 8, extended in 9, contributed by Adobe) does voxel-traced environment
shadows **and carries an optional screen-space shadow component that "adds sharp
shadows to small details" close to the caster**
([docs](https://doc.babylonjs.com/features/featuresDeepDive/postProcesses/IBLShadowsRenderingPipeline/),
[IblShadowsSettings](https://doc.babylonjs.com/typedoc/interfaces/BABYLON.IblShadowsSettings)).
That is precisely the Fortnite and HDRP answer for grass — contact shadows
instead of shadow-map receiving — and I do not have to write it. Dive 6's option
A stops being "turn shadows off and fake it" and becomes **"move grass onto the
shadow system that was designed for small thin details."**

*The frame graph reached v1.0 in 9.0*, with a node-based editor and reported GPU
memory savings of 40%+. A z-prepass (dive 7) and a separate foliage pass are
frame-graph work, not hand-plumbed render targets.

*TAA exists* as a post-process pipeline. Dive 3 named shimmer from sub-pixel
blades as a first-order failure mode; this is the standard cure and it is a
pipeline construction away.

*WebGPU snapshot rendering* records draw calls once and replays them, "up to
×10" — but the documentation is explicit that **the win is JavaScript-side only
and GPU cost is unchanged**. Our frame is 0.97ms CPU against 35ms GPU. So this
is a trap, and worth writing down as one: it is the most advertised WebGPU
optimization in Babylon and it would buy this scene nothing.

*`OpenPBRMaterial` landed in 9.0* with a real subsurface model. Whether it beats
`PBRMaterial.subSurface` for thin leaves is untested by me and worth a look, but
dive 4's conclusion stands either way — the *cheap* translucency term is four
lines in the existing plugin and reads a thickness map I am already baking.

*And the version is fine.* We are on 9.26.0, current.

**Dive 10 — attacking all nine.** The last dive's job was to find what the other
nine had in common, and it is not flattering.

**Nine dives produced about twenty confident causal claims and verified none of
them.** The stats line reports *one* aggregate GPU number. I have not measured
which pass spends the 35 milliseconds — not the field against the terrain, not
the fragment cost against the vertex cost, not the shadow receive against the
subsurface. Every claim in this document about *why* something is slow or dark is
inference from other people's writing about other people's engines.

That is the exact failure this project has already recorded: every confident
causal guess about this renderer has been wrong. The `unlit` test was invalid.
The 217→2900ms regression was Chrome throttling a background tab. `gl.finish()`
reported the whole board at 0.13ms. **So the plan below is ordered by what is
cheapest to falsify, not by what I think is most likely.**

*And here is the alternative explanation nine dives walked past.* The black may
not be on the grass at all. It may be **the ground between the clumps**:

- The meadow is sown in Voronoi clumps, which by construction leaves gaps.
- The terrain is a shadow **caster** and a **receiver**, so the ground genuinely
  is shadow-mapped, correctly, with no bias problem.
- Nothing blends the grass colour into the ground colour. The standard is a
  coverage-driven blend between the two, and reference puts a grassy ground's
  albedo near **0.2** — the road-brown under the sward is far below that.
- Placement is a jittered grid, not blue noise. Casey Muratori's write-ups on
  exactly this problem are blunt: white-noise-ish placement gives you clumps
  *and gaps*, and jitter must stay under about 0.6 of a cell or holes open up
  ([The Color of Noise](https://caseymuratori.com/blog_0010),
  [The Nebraska Problem](https://caseymuratori.com/blog_0011)).

Gaps in the sward, showing correctly-shadowed dark ground, produce the same
picture as acne on the blades. The user said "it's shadows" and would be right
either way — but the *fix* is completely different, and one screenshot cannot
separate them. **A flat-lit render with the terrain hidden separates them in
thirty seconds.**

One more thing all nine missed: nothing checks the **camera**. A wide FOV at a
low angle stretches the near field and flattens the far one, which is one of the
named causes of "the render looks wrong and I cannot say why".

