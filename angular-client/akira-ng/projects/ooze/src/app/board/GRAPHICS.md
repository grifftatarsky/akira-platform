# The meadow's graphics: what it does, what it exposes, what Babylon still has

Written 2026-09-13 against **Babylon.js 9.26.0**, WebGPU. Every capability
claimed below was checked against `node_modules/@babylonjs/core` — the path is
given so the next reader can check it too rather than believing this file.

Companion documents: `BOARD-PLAN.md` is the worklist, `PLAN.md` the rules and
the priced table, `BOARD-HANDOFF.md` the measured state and the research.

---

## 1. What the board draws, in order

One camera, one frame, WebGPU. Numbers are the play camera at
**3600 × 2026 (7.29 MP)** on a freshly started browser, maximum plants,
noon, wind stopped: **27.9 ms**.

| # | Pass | What it is | Cost |
|---|---|---|---|
| 1 | **Sky probe** | `ReflectionProbe` 128³, `refreshRate = 0` — re-rendered only when the clock moves. Feeds `scene.environmentTexture` at `environmentIntensity 0.45` | amortised |
| 2 | **Shadow map** | `CascadedShadowGenerator` 2048, **2 cascades**, `lambda 0.9`, PCF at `QUALITY_MEDIUM`, `cascadeBlendPercentage 0.15`, `stabilizeCascades`, `freezeShadowCastersBoundingInfo`, `shadowMaxZ = max(400, span × 2.6)` | ~3.6 ms |
| 3 | **Opaque** | 40 terrain chunks (PBR, macro albedo + relief normal + ARM surface + detail map), the scanned trees, scrub, stone and ground flora (alpha-tested cut-outs) | — |
| 4 | **Alpha test** | The grass: 4 species, ~481,740 plants, ~10.1M triangles, thin instances fed by a WGSL compute pass, drawn indirect | ~4.9 ms |
| 5 | **Sky box** | `SkyMaterial` on a 6000-unit box, `infiniteDistance` | 0.13 ms |
| 6 | **TAA** | `TAARenderingPipeline`, 16 jittered samples, `factor 0.16`, `clampHistory`, `msaaSamples 1`, `disableOnCameraMove` | ~1.8 ms |
| 7 | **Default pipeline** | `DefaultRenderingPipeline` named `bloom`: bloom off, fxaa off, `samples 1`, image processing **on** — which sets `applyByPostProcess`, so materials output linear and the grading happens here | ~1.0 ms |

**The grade:** KHR PBR Neutral tone mapping, `contrast 1.4`, `vignette 0.1`,
`exposure 1.22 × eyeExposure(elevation)^0.45`. Contrast is high on purpose: seen
from straight above, a meadow is all tips and no shade.

**The light:** a directional sun whose angle, colour and strength come from
`sunPosition(hour, latitude 37.5, day)`; a second directional "bounce" light
along the ground at `0.34 × sun intensity` in warm brown; a `HemisphericLight`
for sky fill. The grass **opts out of image-based light** by overriding
`_getReflectionTexture`, which is why `environmentIntensity` can be raised for
the ground and the scans without the field going pale.

**Two shadow-only layers.** `terrain.ts` builds a second set of 40 chunks lifted
to grass height on layer `0x20000000`, so the field casts a shadow onto the road
without the grass itself being a caster. `standing.ts`'s `shadowProxy()`
decimates any caster over 200k triangles onto layer `0x10000000`. A render
target with an explicit render list ignores `layerMask`, which is the whole
mechanism: no second material, no visibility flag the shadow pass would honour.

---

## 2. What the board exposes today

### The tools panel

| Control | Range | Drives |
|---|---|---|
| Time | 4–21 h | `sunPosition` → sun angle, colour, intensity; sky turbidity/rayleigh/luminance; exposure |
| Season | day 1–365 | sun declination, sward green/bloom mix, albedo tint on ground and scans |
| Grass | 0–100% | `meadow.setDensity` — the compute pass's keep fraction |
| Leaf normal | 0–100% | the `mix(leafNormal, groundNormal)` blend in `blade-wind.ts` |
| Wind | 0–300% | per-plant gust strength |

### Show (content, not quality)

grass · ground flora · trees · stone · terrain · shadows · ground relief ·
sky light · sky dome · grade

### Graphics (quality), with measured cost over a 27.9 ms frame

| Switch | Cost | Sub-choice |
|---|---|---|
| temporal aa | +1.8 ms | — |
| msaa ×2 | +4.6 ms | needs temporal aa; it is MSAA on the TAA target, not the scene |
| ambient occlusion | +8.4 / +26.9 ms | *reads*: ground only · grass too |
| god rays | +4.6 ms | — |
| grass shadows | +8.3 ms | *casts*: trees and stone · everything |
| fast grass | **−3.2 ms** | *lit*: matched · no sheen |
| bloom | +1.6 ms | — |
| render scale | 27.9 → 19.1 ms | 100 / 85 / 75 / 60 / 50% |

### Probe

flat light · split frame (measures every switch that is on) · inspector ·
`bab.shot()` for byte-identical captures · per-pass GPU timings in the HUD.

---

## 3. Knobs the board already has and does not expose

These need no new Babylon feature. They are constants in the source.

| Where | Constant | Now | Worth exposing as |
|---|---|---|---|
| `stage.ts` | `CascadedShadowGenerator(2048, sun)` | 2048 | shadow resolution 1024 / 2048 / 4096 |
| `stage.ts` | `numCascades` | 2 | 2 / 3 / 4 |
| `stage.ts` | `filteringQuality` | `QUALITY_MEDIUM` | low / medium / high |
| `stage.ts` | `usePercentageCloserFiltering` | true | PCF / PCSS (contact hardening) / none |
| `stage.ts` | `cascadeBlendPercentage` | 0.15 | slider |
| `stage.ts` | `lambda` | 0.9 | slider |
| `stage.ts` | `shadows.darkness` | 0 | slider |
| `stage.ts` | `autoCalcDepthBounds` | off | switch |
| `stage.ts` | `depthClamp` | default | switch |
| `stage.ts` | `taa.samples` | 16 | slider 2–32 |
| `stage.ts` | `taa.factor` | 0.16 | slider — how fast the history is replaced |
| `stage.ts` | `taa.disableOnCameraMove` | true | switch (off = smoother pans, ghosting) |
| `stage.ts` | `environmentIntensity` | 0.45 | slider |
| `stage.ts` | `ambient.intensity` | clock-driven | offset slider |
| `stage.ts` | `bloom*` (threshold .86, weight .34, kernel 32, scale .25) | fixed | four sliders |
| `stage.ts` | `image.contrast` | 1.4 | slider |
| `stage.ts` | `image.exposure` | 1.22 × clock | offset slider |
| `stage.ts` | `image.vignetteWeight` | 0.4 | slider |
| `stage.ts` | `image.toneMappingType` | KHR PBR Neutral | Standard / ACES / KHR PBR Neutral |
| `stage.ts` | `scene.fogMode` | **NONE** | off / linear / exp / exp2 + density + colour |
| `stage.ts` | `camera.minZ / maxZ` | 1 / 8000 | affects depth precision; worth a slider |
| `terrain.ts` | `MESH_DETAIL` | 1 | terrain tessellation |
| `terrain.ts` | `bumpTexture.level` | 0.85 | relief strength slider |
| `meadow.ts` | `alphaCutOff` | 0.28 | cut-out threshold slider |
| `meadow.ts` | `roughness` | 0.55 | slider |
| `foliage-cards.ts` | `anisotropicFilteringLevel` | 8 | 1 / 4 / 8 / 16 |
| `species.ts` | per-species counts, lean, rows | fixed | already in the Assets panel, read-only |

---

## 4. What Babylon 9.26 has that the board does not use

Grouped by where it would plug in. **Fit** is my judgement for a top-down
outdoor meadow, not a general one.

### 4a. Already on the installed `DefaultRenderingPipeline` — one flag each

The board constructs this pipeline for bloom and never turns the rest on.
Verified at `PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.pure.d.ts`.

| Feature | Flag | Fit |
|---|---|---|
| **FXAA** | `fxaaEnabled` | An alternative to TAA that does not ghost on a moving camera. TAA is currently the only AA and it is disabled while the camera moves, so FXAA is a real answer to pans |
| **Sharpen** | `sharpenEnabled`, `sharpen.colorAmount`, `sharpen.edgeAmount` | Pairs with render scale — sharpening an upscaled frame is the cheap half of what FSR does |
| **Grain** | `grainEnabled`, `grain.intensity`, `grain.animated` | Taste. Hides banding in the sky gradient |
| **Chromatic aberration** | `chromaticAberrationEnabled`, `.aberrationAmount`, `.radialIntensity` | Taste |
| **Depth of field** | `depthOfFieldEnabled`, `depthOfFieldBlurLevel` (Low/Medium/High), `depthOfField.focusDistance / focalLength / fStop / lensSize` | A tilt-shift look on a battle map is a real want. Needs a depth renderer, so it is not free |
| **Glow layer** | `glowLayerEnabled`, `glowLayer.intensity`, `.blurKernelSize` | For torches, fire and spell effects later. Nothing on a noon meadow emits |
| **MSAA on the whole chain** | `samples` | Distinct from `taa.msaaSamples`. Untested — 3.1 measured the TAA target's sample count, not this |

### 4b. Image processing — already instantiated, mostly unused

`Materials/imageProcessingConfiguration.pure.d.ts`.

| Feature | Property | Fit |
|---|---|---|
| **Tone mapping choice** | `toneMappingType`: Standard, ACES, KHR PBR Neutral | Three genuinely different looks. The board is pinned to one |
| **White balance** | `whiteBalanceEnabled`, `temperature`, `tint` | A warm/cool slider for the hour of day, on top of the sun's own colour |
| **Colour curves** | `colorCurvesEnabled`, `colorCurves` (global/highlights/midtones/shadows × hue/density/saturation/exposure) | A full grading panel, no new pass |
| **Colour grading LUT** | `colorGradingEnabled`, `colorGradingTexture` | Drop-in `.3dl`/`.png` looks. Needs an asset |
| **Dithering** | `ditheringEnabled`, `ditheringIntensity` | Kills 8-bit banding in the sky, near free |
| **Vignette** | `vignetteBlendMode` (multiply/opaque), `vignetteColor`, `vignetteStretch`, `vignetteCentre*`, `vignetteCameraFov` | Only weight is set today |

### 4c. Whole pipelines the board does not install

| Pipeline | Path | Fit |
|---|---|---|
| **FSR1** | `Pipelines/fsr1RenderingPipeline` — `scaleFactor`, `sharpnessStops`, `samples` | **The right partner for render scale.** Render at 60–75% and upscale with FSR1's edge-aware filter instead of the browser's bilinear. Directly attacks the 27.9 → 19.1 ms curve without the mush |
| **SSR** | `Pipelines/ssrRenderingPipeline` — 30+ knobs | Poor fit: nothing on a dry meadow is reflective. Worth it the day there is water |
| **SSAO (v1)** | `Pipelines/ssaoRenderingPipeline` | Cheaper and worse than SSAO2, which is already a setting. Skip |
| **Lens** | `Pipelines/lensRenderingPipeline` — chromatic distortion, grain, edge blur, highlights | Superseded by the default pipeline's own pieces |
| **Standard** | `Pipelines/standardRenderingPipeline` | Carries its own volumetric lights, lens flare and DOF. The board already has god rays and would be installing a second whole chain |

### 4d. Rendering features with no pipeline

| Feature | Path | Fit |
|---|---|---|
| **IBL shadows** | `Rendering/IBLShadows/iblShadowsRenderPipeline` — `resolutionExp`, `voxelGridSize`, `sampleDirections`, `shadowOpacity`, `shadowRemanence`, `ssShadow*`, `coloredShadows` | Voxelises the scene and ray-marches shadows from the environment map. This is the technique that would give the meadow **sky occlusion** — the thing SSAO is a screen-space approximation of. Expensive and it has to voxelise 10M triangles of grass, so the interesting question is whether it can run on the terrain and trees only |
| **RSM global illumination** | `Rendering/GlobalIllumination/giRSMManager` | Bounce light from a reflective shadow map. The board fakes this with a second directional light already; the real thing would colour the bounce by what it hit |
| **Motion blur** | `PostProcesses/motionBlurPostProcess` — `motionStrength`, `motionBlurSamples`, `isObjectBased` | Object-based needs velocity in the prepass, which is the 18.5 ms the grass costs SSAO. Camera-based is cheap and would smooth pans |
| **Screen-space curvature** | `PostProcesses/screenSpaceCurvaturePostProcess` — `ridge`, `valley` | Needs the normals prepass. Draws creases on the terrain; on grass it would be noise |
| **Depth peeling** | `Rendering/depthPeelingRenderer` | Order-independent transparency. Would let foliage alpha-**blend** instead of alpha-test — softer edges, no cut-out crunch. This is the one rendering feature that could change how the grass *looks* rather than how fast it is. Very expensive |
| **Edges / outline renderer** | `Rendering/edgesRenderer`, `outlineRenderer` | Token and token-selection work, not landscape |
| **Selection outline layer** | `Layers/selectionOutlineLayer` | The same, and it is the right tool when tokens land |
| **Reflection probes** | `Probes/reflectionProbe` | Already used for the sky. A second one at ground level would give the scans a real local environment |

### 4e. Engine and scene levers

| Feature | Where | Fit |
|---|---|---|
| **Snapshot rendering** | `engine.snapshotRendering`, `snapshotRenderingMode` (WebGPU only) | Records the command bundle once and replays it. The board's draw list is static between frames — the compute pass and the uniforms change, not the calls — so this is worth measuring. `FAST` mode forbids changing the number of draws, which the indirect grass may violate |
| **Scene performance priority** | `scene.performancePriority` (`BackwardCompatible` / `Intermediate` / `Aggressive`) | Turns off per-frame bounding-info sync and other safety. Aggressive is exactly the kind of flag that silently breaks picking |
| **Scene optimizer** | `Misc/sceneOptimizer` — `targetFrameRate`, degradation levels | An auto-quality ladder. It would fight a settings menu; better as a one-shot "tune for 60" button |
| **Hardware scaling** | `engine.setHardwareScalingLevel` | Already the render-scale setting |
| **Anisotropy** | `texture.anisotropicFilteringLevel` | The foliage atlas is at 8. 16 costs little and helps grazing angles |
| **Mesh simplification** | `Meshes/meshSimplification` — quadric decimation | 2.5 measured this by hand and refused it to the asset; the built-in simplifier is a second opinion on the same question |
| **LOD levels** | `mesh.addLODLevel` | Banned for foliage by standing rule — but a tree swapping to a cheaper *mesh* at distance is a representation change, not a thinning, and that distinction was never tested |

### 4f. Content the engine supports and the board has not used

Particles (`Particles/`) for pollen, seed heads, dust off the road, rain and
snow — the theme already carries a `motes: 0.22` that nothing reads. Lens
flares (`LensFlares/`) for the sun. Sprites for distant birds. `Layer` for a
background. Decals (`material.decalMap`) for scorch marks and blood. None of
these is a graphics *setting*; they are the next content pass.

---

## 5. The order I would take them

Grouped so each batch is one measurable change, cheapest and safest first.

**Batch A — the free grade.** Everything in 4b plus 4a's grain, sharpen,
chromatic aberration and FXAA. No new pass, no new buffer, all of it one flag or
one float. This is where "every setting exposed" gets most of its list.

**Batch B — the knobs that already exist.** Section 3: shadow resolution,
cascades, filter, blend, TAA samples and factor, bloom's four numbers, fog,
relief strength, anisotropy, alpha cut-off. No new Babylon surface at all.

**Batch C — FSR1.** The only item that makes a *bad* setting good: render scale
is currently bilinear upscaling, and 50% is visibly mushy. Measure FSR1 at
60/75% against native.

**Batch D — depth of field and camera motion blur.** Both want the depth
renderer; measure that once and both become cheap.

**Batch E — snapshot rendering.** Potentially the largest single win left, and
the most likely to break the indirect grass. Its own lab.

**Batch F — IBL shadows.** The big one. Sky occlusion done properly, with the
open question being whether the voxeliser can be given the terrain and trees
only, the way SSAO's g-buffer was.

**Batch G — depth peeling.** The only thing here that would change how the
foliage *looks* rather than how fast it runs. Expensive, and it is the answer to
the cut-out crunch on every leaf edge.
