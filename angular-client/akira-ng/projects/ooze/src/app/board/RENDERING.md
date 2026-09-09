# Rendering the board

What the board is aiming at, how it is put together, and the things that cost
real time to work out. Asset sourcing and licensing live in `ASSETS.md`.

## The target

**Divinity: Original Sin 1.** Named by the person this is for, and treated as a
direction rather than a spec — the pack is stylised and the board is a tactical
tool, so "as good as that, with these constraints" is the bar. What that
actually implies, in order of how much it mattered:

1. **Local coloured light.** Torch pools, warm bounce, deep falloff. Not a nice
   sky — the signature is that a room is lit *by things in it*.
2. **Everything planted.** Contact darkening where surfaces meet. Without it a
   correctly-lit prop still reads as pasted on.
3. **Warm and saturated**, not photoreal. This is painted, not photographed,
   and the colour pipeline is tuned that way on purpose.
4. **A long lens.** Closer to isometric than to a game camera.

## The pipeline

```
scene ──► RenderPass ──► GTAOPass ──► UnrealBloomPass ──► OutputPass ──► grade
          (half-float targets throughout)                  tone curve    opinion
```

In the scene itself, before any of that:

- **`scene.environment`** — a 1k HDR capture convolved to an irradiance map.
- **A single warm directional light**, aimed at the board and sized to it, doing
  shape and shadow only.
- **A light field** — the board's light levels and every flame on it baked into
  a small image that every material samples once.
- **Ambient at 0.08**, which is a floor and not a light source.

## Things that cost real time

### Lighting

- **A PBR material with no environment is a photograph of plasticine.** Every
  KayKit piece is a `MeshStandardMaterial` at metalness 0, roughness 0.45 —
  measured out of the glTF, not assumed. With `scene.environment` unset it gets
  no ambient specular at all and no directional ambient, so one flat ambient
  term plus one sun is all the light there is. This was the single biggest
  change on this board.
- **Local light is a texture, not lights.** A shadow-casting point light costs
  six renders of the scene, so a torch per sconce is not a lighting rig, it is a
  slideshow. `light-field.ts` bakes them into an image at four texels per
  five-foot square. Two hundred lights cost what two do.
- **The light multiply goes before `tonemapping_fragment`, not after.** Three's
  last chunk (`dithering_fragment`) is the obvious hook and the wrong one: by
  then the colour has been through the tone curve and encoded to sRGB, so
  scaling there darkens a *display value* rather than reducing an amount of
  light — and a torch can never be brighter than white.
- **Set `customProgramCacheKey` on any material you patch.** Without it three
  reuses a cached program compiled from an identical unpatched material, and the
  injection silently does nothing for every material after the first. The key
  must include anything compiled into the shader (here: the light blend, and
  whether the surface ripples).
- **Deduplicate patched materials.** A cloned model shares its source's
  material, so a room with thirty barrels hands back the same material thirty
  times; patching twice injects the sample twice, squares the light, and turns a
  torch into a floodlight.
- **Metalness tints reflections by the base colour and drops the diffuse.**
  Water at 0.35 reflected a warm cellar as bright cyan and stopped reading as
  water. Water is a dielectric: metalness 0, roughness ~0.12.
- **Khronos PBR Neutral, not ACES.** Both roll highlights off; ACES also
  desaturates hard doing it, because it emulates film. Torchlight that goes
  cream in the middle of the pool is the look we are aiming away from.
- **Bloom threshold has to clear the scene's own brightness.** A lit floor is
  already about 1.0 of linear radiance, so a threshold of 1.05 caught every
  torchlit surface and hazed exactly the rooms it was meant to pick lights out
  of.

### Post-processing

- **`EffectComposer.setSize` already forwards the device size to every pass.**
  Calling `setSize` on a pass afterwards undoes that with the CSS size. On a 1x
  display the two are identical and nothing is wrong; on a 2x one the board
  renders into a quarter of its canvas with the rest black, which looks exactly
  like a layout bug.
- **Every GTAOPass default is written for a world measured in metres.** This
  world is measured in half-feet, so the default 0.25 radius is an inch and a
  half and finds nothing. Four half-feet — two feet — is the scale of the crease
  where a crate meets a floor.
- **Rendering to a target disables in-material tone mapping automatically**, so
  `renderer.toneMapping` can stay set and `OutputPass` applies it once at the
  end. Half-float targets are required or a torch pool clips to white before
  the bloom pass ever sees it.

### Geometry

- **Two surfaces at the same depth are a coin toss re-thrown every frame**,
  which is what a board that shimmers while you pan actually is. Structure sits
  `ART_CLEARANCE` inside the art it backs.
- **A wall's box is its mass, not decoration.** KayKit's wall is a 1¼-foot
  facing panel; hiding the box behind it left every corner and junction with a
  hole through it.
- **The pack disagrees with D&D about how big a tile is.** Its floors and walls
  are 4.00 units across and its walls 4.00 tall — a 10-foot dungeon. Floors and
  walls are forced to the 5-foot square because the grid is not negotiable;
  props are drawn at the pack's own scale, or a table comes out doll-sized.
- **Where art and rules disagree, the rules win.** `PieceModel.heightHalfFeet`
  stretches a piece to a height the board declares — walls to 8 feet, stairs to
  exactly the 5-foot step they serve rather than the 10.2 their proportions
  would give.
- **glTF is Y-up and this world is Z-up.** The loader rotates once, for every
  pack. Note that scale is applied in the object's *own* frame: to stretch world
  Z on the rotated node you scale its local Y.

### Tokens

A token is neither scenery nor an overlay, and both extremes were built before
that was obvious. Fully lit, it vanishes the moment a creature walks into the
dark — exactly when a DM needs to find it. Fully unlit, it escapes the
atmosphere and reads as a plastic counter dropped onto a painting, and gets
worse every time the lighting improves. It now takes about half the board's
light, on a base whose side is fully lit and casts a shadow.

## Escape hatches

- **The `Effects` toggle** drops the AO and bloom passes. The environment, the
  tone curve and the light field all live in the scene and remain.
- **The `Plain` theme** is the board with no models at all: coloured boxes, and
  every room, rule and light level intact. Deleting `public/assets/board/` is a
  supported thing to do.
- **A missing environment map** falls back to three's generated `RoomEnvironment`
  — a worse dungeon and a perfectly good light.

## Not done yet

- **Instancing.** Every tile and prop is its own mesh, so a furnished level is
  roughly 650 objects before the shadow and AO passes multiply it. One geometry
  and one material per piece type makes `InstancedMesh` straightforward; the
  obstacle is that `dressTerrain` relies on a tile's index in the terrain group.
- **Dust and atmosphere.** The reference has motes in its light shafts.
- **Emissive flames.** The pack's flame is a few pixels of a shared texture
  atlas, so there is no way to make part of it glow; the current glow is an
  additive sprite over the top.
