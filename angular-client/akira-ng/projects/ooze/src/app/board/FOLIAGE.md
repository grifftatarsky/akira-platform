# Where this can go

A survey, written after the meadow was working and the question became "what
are we *not* doing." Five parts, in the order they were asked: the library, the
platform, grass specifically, the meshes and the placement, and what is left on
the table for performance.

Verdicts first, because the rest is argument:

| Question | Answer |
|---|---|
| Is three.js the right library? | Yes. Nothing else is close for this shape of problem. |
| Should we move to WebGPU? | Eventually, not now. It is a rewrite of every shader we have. |
| What is the single biggest visual win available? | **Translucency.** Grass with a low sun behind it should glow. |
| The single biggest believability win? | **Clumping.** Real fields are not evenly random. |
| The single biggest performance win left? | **Fewer, larger plants near the ground, and none we cannot see.** |

---

## 1. The library

### Where we are

three.js r186, `WebGLRenderer`, GLSL injected into three's own shaders through
`onBeforeCompile`. That last part matters for everything below: our light field,
our wind, our blade widening and our ground splat are all *string surgery on
three's shader chunks*. It is a genuinely load-bearing decision and it is why
some otherwise attractive options are expensive.

### The alternatives, honestly

**Babylon.js.** A full engine rather than a renderer: node material editor,
better glTF extension coverage (clearcoat, transmission, sheen), a scene
inspector, physics in the box. Backed by Microsoft. If we were starting today
and wanted batteries included, it would be a real contender. Against it: our
whole shading approach is shader injection, and Babylon's node materials are a
different authoring model — we would be rewriting the light field, the splat
ground and the meadow. It buys us tooling we are not short of and costs us
everything we have built. **No.**

**PlayCanvas.** Strongest mobile performance and a genuinely interesting feature
for us: runtime-baked lightmaps. Aimed at teams working in a hosted editor. The
editor is the product and we are not going to use it. **No.**

**Unity / Unreal to WebGL or WebGPU.** Both can export to the web. Both produce
tens of megabytes of runtime, take over the page, and would put a game engine
between our rules engine and its picture. This is a D&D compendium with a board
attached, not a game with a compendium attached. **No.**

**three.js `WebGPURenderer` + TSL.** The interesting one. Production-ready since
r171, with WebGL2 fallback, and every major browser now ships WebGPU (Safari
since 26). It brings two things we would actually use:

- **Compute shaders.** Blade placement, culling and LOD selection could move to
  the GPU entirely — which is how *Ghost of Tsushima* does grass. Instead of
  830,000 matrices composed in JavaScript on load, a compute pass would generate
  blades per visible tile per frame, and an indirect draw would render exactly
  the ones it produced. This is the technique that makes million-blade fields
  cheap, and it is not available to us on WebGL2 at all.
- **Lower driver overhead per draw call**, which is exactly the cost we ran into
  chunking the meadow.

Against it: **TSL is a node graph, not a string**, so every `onBeforeCompile`
we have — the light field, the wind, the widening, the splat ground's generated
per-layer samplers, the water ripple, the grade — is a rewrite. That is most of
the rendering code. It is the right destination and the wrong week.

**Verdict: stay on three.js WebGL2.** Revisit WebGPU when the meadow's placement
becomes the bottleneck rather than its shading, because that is the thing only
compute can fix.

---

## 2. The platform, beyond libraries

Things available to us that are not a choice of renderer.

### Texture format — the clearest unclaimed win

We ship **JPEG**. The browser decodes it to RGBA and uploads 32 bits a pixel. Our
grass variant array is six 1k layers — 25 MB of VRAM — and the road's five 2k
variants are 84 MB. **KTX2 + Basis** transcodes to the GPU's own compressed
format (BC on desktop, ASTC/ETC on mobile) and cuts that by 4–6× *with no
decode step*, which also removes the canvas round-trip in `texture-array.ts`.
three ships `KTX2Loader`. This is a build-step change and a loader swap, and it
is worth doing.

### Geometry format

Models are raw glTF. **Draco** or **meshopt** compression would cut download
substantially. Less urgent than textures because our model count is small, but
free once the pipeline exists.

### Rendering targets we are not using

- **`OffscreenCanvas` + worker.** Moves the whole renderer off the main thread.
  Real benefit: the 830,000-matrix build that currently freezes the tab for a
  moment on every density change would stop touching the UI thread at all.
- **`requestVideoFrameCallback` / adaptive resolution.** Measure frame time,
  drop the buffer's height when it slips, raise it when there is headroom. We
  already have the ceiling; making it dynamic is a small change and it is what
  every console game does.
- **Half-resolution transparency and effects.** Bloom especially — it is a blur;
  it does not need full resolution.

### Style as solution

Worth saying plainly, because it is the cheapest lever in this document and the
one most likely to be right.

Every technique below is in service of a *photographic* meadow. The stated
target is **Divinity: Original Sin**, which is a painted one. A painted meadow
does not need a million blades, because it is not pretending each blade is real
— it needs a strong silhouette, a confident palette, and readable contrast
between what matters (creatures, cover, terrain) and what does not (everything
else). Concretely, moving toward that would mean:

- **Fewer, larger, more deliberate plants.** A hand-placed clump of five kinds
  of grass reads better at play distance than a statistical field of one.
- **Painted colour rather than measured colour.** We are already tinting scans;
  going further — a deliberate three-colour palette per map — is a stronger look
  and costs nothing.
- **Contrast as a gameplay tool.** The board's job is to be read. A meadow that
  is uniformly interesting is a meadow that competes with the tokens on it.

This is not an argument against the realism work. It is an argument that the
realism work should stop at the point where the board reads better, and that we
should decide where that point is rather than discovering it.

---

## 3. Grass, properly

The techniques below are drawn from *Ghost of Tsushima*'s GDC talk, Crysis's
vegetation chapter in GPU Gems 3, and the academic LOD literature. Ordered by
what they would buy us.

### 3.1 Translucency — the biggest thing we are missing

A blade of grass is thin and it **transmits light**. With the sun behind it, it
glows; that glow is most of what makes photographs of fields look like fields.
We currently shade grass as an opaque diffuse surface, which is why our evening
is warm but flat.

Crysis's approximation, which is cheap and still the standard:

```
translucency = (-N · L) * (E · L) * thickness
```

— light coming *through* the surface toward the eye, strongest when the eye is
looking into the sun through the blade. Plus their back-face treatment, which is
a wrapped diffuse rather than a hard terminator:

```
back = saturate(dot(-N, L) * 0.6 + 0.4)
```

We do not need a thickness texture; a vertex attribute is enough, and we already
have a root-to-tip ramp to hang it on — a tip is thinner than a base.

**This is the change to make first.** It is a handful of lines in the plant
shader and it changes what the meadow *is* at every hour of the day.

### 3.2 Clumping — the biggest believability win

From the *Ghost of Tsushima* talk, and stated there as an art-direction problem
rather than a technical one: **real fields are not random, they are clumpy.**
Their solution is a Voronoi clump map. Each blade finds its nearest clump
centre; the clump — not the blade — decides height, orientation and colour, and
the blade is pulled toward the clump's facing.

Our placement gives every plant an independent random height, tilt, turn and
tone. That is *uniform noise*, and uniform noise reads as manufactured however
fine it is. Patches of tall grass, patches of short, patches leaning together —
that reads as grown.

We already have the machinery: the species drift fields are exactly this idea at
the wrong scale (tens of feet, deciding *which* species). Clumping is the same
thing at three feet, deciding *what that plant is like*.

### 3.3 The blade itself

Ghost of Tsushima builds each blade as a **Bézier curve** — a root, a tip and a
control point — rather than a fixed arc. That gives per-blade droop, wind
response along the curve, and a natural taper, and it is what lets one blade
shape serve as everything from stiff young grass to a heavy seed head.

Ours is a fixed sine arc with a per-strip lean. Moving to a Bézier evaluated in
the vertex shader would let the *wind bend the curve* rather than translating the
tip, which is the difference between a blade bending and a blade leaning.

### 3.4 LOD, done properly

The literature is consistent on a three-tier scheme:

1. **Near** — full blade geometry.
2. **Middle** — fewer segments per blade, fewer blades, wider blades.
3. **Far** — no geometry at all; a *texture* on the ground that matches the
   colour and density of the geometry it replaces.

We do tiers 1 and 2 (the pixel-budget thinning) but not 3 — our far field is
still individual plants. Since the ground splat is already a photograph of
grass, the far tier is nearly free: fade the geometry out over a band and let
the painted ground carry it. That is a straight saving of most of the meadow on
a zoomed-out board.

### 3.5 Wind, layered

Crysis separates **main bending** (the whole plant, along the wind, scaled by
height) from **detail bending** (leaf edges and tips, high frequency, phase per
leaf). We have main bending with a gust field. Detail bending is what makes
grass look *alive* rather than *pushed*, and it is a per-vertex term we can
drive from the existing UVs — the edge of a leaf flutters, its spine does not.

### 3.6 Density: what is actually needed

The honest answer from the literature is that **you cannot win the density fight
with geometry alone**, and nobody tries. The ground under the grass is a
photograph of ground *with grass in it*; the geometry adds silhouette,
translucency and motion on top of a surface that already reads as grass. Our
splat ground is already doing this job.

So the question "how much clover do we need to hide the ground" has the wrong
shape. The answer is: **enough that the silhouette is unbroken where the camera
can see silhouette, and no more** — which is a screen-space quantity, which is
what the pixel budget already computes. What is missing is the *ground* holding
up its end: if the painted ground under a thin patch matched the geometry above
it, thinning would be invisible.

---

## 4. Meshes and placement

### The clover

Fair criticism. It is three tapered strips per head, four heads, and it reads as
a green shape rather than a plant. What a clover actually has that we do not:

- **A notched, heart-shaped leaflet.** Our leaf profile is a smooth lobe. The
  notch at the tip is the single most recognisable thing about clover.
- **The pale crescent band**, across the leaf about a third from the base. We
  approximate it with a root-to-tip ramp, which puts it in the wrong place — it
  is a *band*, not a gradient.
- **A visible petiole**, and leaflets that meet at a point above the ground
  rather than radiating from it.

All three are achievable in the strip model with one addition: a mid-strip
colour stop, and a width profile that can go non-monotonic. Neither is expensive.

### Are we set up for a user drawing terrain and sliding density?

**Mostly yes, with two real gaps.**

What is already right:

- Placement is **derived from fields, not from a list**. Wear, wetness, height
  and the species drifts all come from `groundField`, which is computed from the
  map's own cells. A user painting terrain changes the cells; everything
  downstream follows. This is the correct architecture and it was worth the
  trouble.
- Density is a multiplier on **plants per area**, and punctuating species hold
  their absolute count. Both behave correctly across the whole slider range.
- Chunking means a local edit could rebuild a local chunk.

What is not:

1. **The rebuild is global and synchronous.** Changing density rebuilds all
   830,000 plants on the main thread. For a slider a user drags while painting,
   that has to become *per-chunk and incremental* — rebuild the chunks the edit
   touched. The chunk structure exists; the rebuild path does not use it.
2. **Species are a module constant, not map data.** `SPECIES` is a hard-coded
   array in `meadow.ts`. A coast wants sea grass, a wood wants ferns, a snowfield
   wants nothing. This needs to move onto the theme before there can be a second
   kind of ground — which makes it a blocker for every map after this one.

---

## 5. Performance still on the table

Ordered by ratio of win to work.

1. **A far tier that is not geometry** (§3.4). Biggest single saving available.
2. **KTX2 textures** (§2). Cuts VRAM 4–6× and removes the canvas decode.
3. **Per-chunk instance buffers updated incrementally**, so density and edits do
   not rebuild the world.
4. **`OffscreenCanvas`**, so none of that touches the UI thread.
5. **Adaptive resolution** against measured frame time.
6. **Merge species per chunk into one `BatchedMesh`.** three's `BatchedMesh`
   draws multiple geometries sharing a material in one call — five species per
   chunk become one draw instead of five. Our draw count is currently 127 and
   most of it is this.
7. **A BVH over chunks** rather than three's per-object frustum test. Matters at
   a much larger chunk count than we have; noted for completeness.
8. **Compute-driven placement** (§1), which is the WebGPU endgame and makes
   items 1, 3 and 6 mostly moot.

---

## Sources

- Wohllaib, E. — *Procedural Grass in 'Ghost of Tsushima'*, GDC Advanced
  Graphics Summit.
- Sousa, T. — *Vegetation Procedural Animation and Shading in Crysis*, GPU Gems
  3, chapter 16.
- Jahrmann, K. & Wimmer, M. — *Interactive Grass Rendering Using Real-Time
  Tessellation*, TU Wien.
- Boulanger, K. et al. — *Rendering Grass in Real Time with Dynamic Lighting*.
- three.js migration and performance notes, r171–r186.
