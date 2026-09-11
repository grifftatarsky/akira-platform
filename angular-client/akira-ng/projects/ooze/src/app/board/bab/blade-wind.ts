import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

/**
 * What turns a strip of green into a blade of grass.
 *
 * <p>Three things, all from the *Ghost of Tsushima* talk, all in the vertex
 * stage where they cost a few instructions rather than any geometry:
 *
 * <ul>
 * <li><b>A Bezier curve.</b> The blade arcs over instead of standing straight,
 *     and the arc is most of what a field looks like at any distance because
 *     it is the silhouette.
 * <li><b>Wind that bends it.</b> Not a rigid turn about the root, which is all
 *     an instance matrix can do — the tip travels and the base does not.
 * <li><b>Root-to-tip shading.</b> Dark at the ground, pale and dry at the tip.
 * </ul>
 *
 * <p>The fourth, rounded normals, is baked into the blade's geometry instead:
 * it is static per vertex, so it costs a buffer rather than a shader.
 *
 * <p>Before this the wind lived in the compute pass, re-sowing six hundred
 * thousand blades every frame to change a lean. The compute pass now runs when
 * the density changes and not otherwise.
 */
export class BladeWind extends MaterialPluginBase {

  /** Seconds. The only thing that changes per frame. */
  time = 0;
  /** Downwind direction across the board, and how hard it blows. */
  eastward = 0.82;
  northward = 0.57;
  strength = 1.35;
  /** What the tip is coloured relative to the root, and how dark the root is. */
  tip: [number, number, number] = [1.2, 1.18, 0.98];
  floor = 0.28;

  /**
   * How far the shading normal is pulled onto the ground's own normal.
   *
   * <p>One for a blade of grass, which is what Breath of the Wild does — it
   * copies the terrain's normal outright, and a field shaded that way reads as
   * one surface with texture on it rather than as ten thousand separately lit
   * slivers. Less for anything with a real leaf, because a clover leaflet *is*
   * a surface and should be allowed to catch the light as one.
   *
   * <p>It also has to stay above about 0.6. Below that a leaf whose own normal
   * points at the ground can still drag the blend under the horizon, and a
   * normal under the horizon takes the hemispheric light's brown, which is the
   * black that has been eating this field since the beginning.
   */
  ground = 0.8;

  /**
   * How sharply the stem curves under its own weight: radians of turn per unit
   * of length, so a stem of height `h` has bent through `droop * h` at its tip.
   *
   * <p>This was a tilt of the whole instance matrix. It is a bend now, for two
   * reasons: a stem bends along its length rather than hinging at its root, and
   * a tilted matrix no longer has the ground's normal in its up column — which
   * is the thing {@link ground} needs it to have.
   *
   * <p><b>A curvature and not a slope.</b> It was the tangent of the lean, used
   * to shear the blade sideways, with a hand-fitted term taking height back off
   * so the sheared blade did not stretch. That term was quadratic in a quantity
   * measured in half-feet, so on the one plant tall enough to matter — the
   * Yorkshire fog, at four and a bit — it went past one, turned the height
   * negative, and stood the whole species upside down under the meadow. Nothing
   * hand-fitted replaces it: the arc below is exact.
   */
  droop = 0;

  /**
   * How far an edge-on plant is turned toward the camera, as a fraction.
   *
   * <p>A blade is a flat strip, and a flat strip seen along its edge is a line.
   * Ghost of Tsushima calls the cure view-space thickening — the blade's
   * vertices are pushed apart in the camera's own X so it keeps a readable
   * width — and turning the strip about its own stem is the same thing said
   * geometrically.
   *
   * <p>Never all the way. At one every plant faces the camera squarely, which
   * is a wall of cards and reads worse than the slivers it replaced; the field
   * also visibly swims when the camera turns. Half keeps the variety and closes
   * the gaps.
   */
  face = 0.5;

  /**
   * The species' own height in half-feet, before the clump scales it.
   *
   * <p>Only to turn a vertex's height into a fraction of the plant. That used
   * to be a uv channel; the uv points into the foliage sheet now.
   */
  tall = 1;

  constructor(material: Material) {
    super(material, 'BladeWind', 200, { BLADE_WIND: true });
    this._enable(true);
  }

  override getClassName(): string {
    return 'BladeWind';
  }

  /**
   * <p>Without this the plugin is refused outright — "not compatible with the
   * shader language of the material". Answering only for WGSL is not enough
   * either: the manager asks at construction, before the material has settled
   * which language it will compile in. So this accepts the question and
   * {@link getCustomCode} declines to emit anything but WGSL, which is the
   * same guarantee made one step later.
   */
  override isCompatible(): boolean {
    return true;
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines['BLADE_WIND'] = true;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[] } {
    return {
      ubo: [
        { name: 'bladeWind', size: 4, type: 'vec4' },
        { name: 'bladeTip', size: 4, type: 'vec4' },
        { name: 'bladeGround', size: 4, type: 'vec4' },
        { name: 'bladeTall', size: 4, type: 'vec4' },
      ],
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat4(
      'bladeWind', this.eastward, this.northward, this.strength, this.time,
    );
    uniformBuffer.updateFloat4(
      'bladeTip', this.tip[0], this.tip[1], this.tip[2], this.floor,
    );
    uniformBuffer.updateFloat4('bladeGround', this.ground, this.droop, this.face, 0);
    uniformBuffer.updateFloat4('bladeTall', Math.max(0.05, this.tall), 0, 0, 0);
  }

  override getCustomCode(
    shaderType: string, shaderLanguage?: ShaderLanguage,
  ): Record<string, string> | null {
    if (shaderType !== 'vertex' || shaderLanguage !== ShaderLanguage.WGSL) {
      return null;
    }
    return {
      // <p>The height up the blade is read from the vertex's own local Y,
      // which the geometry lays out as nought to one. Reading it from the uv
      // instead — the obvious way — does not work: `vertexInputs.uv` is only
      // declared when something in the material wants it, and this material
      // has no texture at all. Pushing the attribute does not help and neither
      // does the define, because a plugin's defines do not reach the
      // material's. The shader just fails to parse, as a validation warning,
      // with no exception anywhere and a field with no grass in it.
      //
      // <p>`bladeAlong` is deliberately declared outside the braces: the hooks
      // are separate injection sites in one function, so this is how the
      // shading block below sees it.
      //
      // <b>Height up the plant, from the vertex's own Y.</b> It used to come
      // from `uv.y`, which the generated meshes laid out as nought to one along
      // a leaf. The uv points into the foliage sheet now — a card has to say
      // which cut-out it is showing, and that is the only channel a material
      // samples albedo from — so the height is divided out of the position
      // instead, against the species' own height carried in the uniform.
      CUSTOM_VERTEX_UPDATE_POSITION: `
        var bladeAlong = clamp(positionUpdated.y / uniforms.bladeTall.x, 0.0, 1.0);
        {
          let root = vertexInputs.world3.xyz;

          // Gusts: three waves at unrelated angles and speeds, under a slower
          // envelope that makes the wind come and go. One travelling sine is a
          // bar crossing the field with every blade in it leaning together,
          // which is what the wind used to look like here.
          let t = uniforms.bladeWind.w;
          let w1 = sin(dot(root.xz, vec2f(0.021, 0.013)) - t * 1.5);
          let w2 = sin(dot(root.xz, vec2f(-0.009, 0.026)) - t * 0.9 + 2.1);
          let w3 = sin(dot(root.xz, vec2f(0.041, -0.031)) - t * 2.7 + 4.3);
          let envelope = 0.55 + 0.45 * sin(dot(root.xz, vec2f(0.004, 0.003)) - t * 0.35);
          let gust = (0.5 + 0.5 * (w1 * 0.55 + w2 * 0.3 + w3 * 0.15)) * envelope;
          let over = uniforms.bladeWind.z * (0.35 + 0.65 * gust);

          // A quadratic Bezier in the blade's own plane, forward against up.
          // The tip loses height as it goes over, which is what stops a
          // bending blade from stretching.
          let c1 = vec2f(over * 0.10, 0.55);
          let c2 = vec2f(over * 0.72, 1.0 - over * over * 0.22);
          let m1 = mix(vec2f(0.0, 0.0), c1, bladeAlong);
          let m2 = mix(c1, c2, bladeAlong);
          let curve = mix(m1, m2, bladeAlong);

          // Where this blade's local axes ended up in the world, so it leans
          // downwind rather than whichever way it happens to be facing.
          let sideways = normalize(vertexInputs.world0.xyz);
          let facing = normalize(vertexInputs.world2.xyz);
          let downwind = vec3f(uniforms.bladeWind.x, 0.0, uniforms.bladeWind.y);

          // <b>Displace, do not replace.</b> Setting the vertical outright
          // works for one upright blade and destroys anything else: a clover's
          // leaflets carry their own direction in their local coordinates, and
          // overwriting Y folds them flat into the stem. Pushing downwind and
          // shortening by the same curve bends a blade and a leaflet alike.
          // <b>The plant's own droop, in its own facing direction.</b> The
          // wind bends it downwind; this bends it the way it happens to be
          // leaning, which is what stops a field looking combed. Squared along
          // the length, because a stem bends most where it is thinnest.
          //
          // <p>The dice is a stable hash of where this plant is rooted, so one
          // plant droops the same amount every frame and its neighbour does
          // not. Hashed from the world position rather than an index because
          // the vertex stage has no index, and from nothing that changes with
          // the frame or the field would boil.
          let root2 = floor(vertexInputs.world3.xz * 8.0);
          var hashed = (u32(abs(root2.x) + 4096.0) * 73856093u)
            ^ (u32(abs(root2.y) + 4096.0) * 19349663u);
          hashed ^= hashed >> 13u;
          hashed *= 0x5bd1e995u;
          hashed ^= hashed >> 15u;
          let dice = f32(hashed & 0xffffffu) / 16777216.0;
          //
          // <p><b>A circular arc, integrated, not a shear with a correction.</b>
          // Let the stem turn at a constant curl of c radians per unit of its
          // own length; then the point an arc-length s up it sits at
          // sin(c*s)/c along the stem and (1 - cos(c*s))/c out from it. That is
          // exact, it preserves length by construction, and it cannot invert —
          // which the shear it replaces could and did, standing the tall grass
          // upside down beneath the field.
          let curl = uniforms.bladeGround.y * (0.35 + 0.65 * dice);
          let arc = positionUpdated.y;
          // Short of a right angle at the tip. Nothing here asks for more, and
          // past it a leaf starts passing back through the plant's own stem.
          let turned = clamp(curl * arc, -1.5, 1.5);
          let straight = curl < 0.0001;
          let rise = select(sin(turned) / curl, arc, straight);
          let reach = select((1.0 - cos(turned)) / curl, 0.0, straight);

          let sink = 1.0 - over * over * 0.18 * bladeAlong;
          positionUpdated = vec3f(
            positionUpdated.x + curve.x * dot(downwind, sideways),
            rise * sink,
            positionUpdated.z + curve.x * dot(downwind, facing) + reach);

          // <b>Turn an edge-on plant toward the camera.</b> A blade is a flat
          // strip and a flat strip seen along its edge is a line — which is
          // most of what "negative space" means in a field of them. Turning it
          // about its own stem costs no geometry and closes the gap.
          //
          // <p>The stem is the axis on purpose: a plant that rolled about any
          // other would lift off the ground or lean out of its clump.
          let stem = normalize(vertexInputs.world1.xyz);
          let toEye = scene.vEyePosition.xyz - vertexInputs.world3.xyz;
          // Only the part of the view direction that lies across the plant
          // matters; looking straight down at a blade, there is nothing a turn
          // about its stem can do and nothing that needs doing.
          let flatEye = toEye - stem * dot(toEye, stem);
          let sideways2 = length(flatEye);
          if (sideways2 > 0.001) {
            let want = cross(stem, flatEye / sideways2);
            let has = normalize(vertexInputs.world0.xyz);
            var turn = atan2(dot(cross(has, want), stem), dot(has, want));
            // A strip and the same strip turned half a circle have the same
            // silhouette, so there is always a short way round. Taking the long
            // way is a plant spinning most of a turn to arrive where it started.
            turn = turn - 3.14159265 * round(turn / 3.14159265);
            let by = turn * uniforms.bladeGround.z;
            let cb = cos(by);
            let sb = sin(by);
            positionUpdated = vec3f(
              positionUpdated.x * cb - positionUpdated.z * sb,
              positionUpdated.y,
              positionUpdated.x * sb + positionUpdated.z * cb);
          }
        }
      `,

      // <b>Dark at the ground, pale at the tip.</b> Light does not reach the
      // bottom of a sward — there is a foot of grass above it — and the tips
      // are drier and thinner and let more through. Two lines, and it is the
      // difference between a field and a green carpet.
      CUSTOM_VERTEX_MAIN_END: `
        {
          // <b>Shade by the ground, not by the leaf.</b>
          //
          // <p>What was here was a clamp: hold the world normal above the
          // horizon, because a normal pointing at the ground takes the
          // hemispheric light's brown and reads as black. It worked and it was
          // a symptom's treatment — the normals it was rescuing are authored
          // fiction, fanned across each leaf and floored in the geometry, and
          // no clamp makes fiction true.
          //
          // <p>The ground's normal is not fiction. It is carried per instance
          // from the compute pass, it cannot point below the horizon on a
          // heightfield, and blending onto it is what makes a field read as one
          // lit surface instead of ten thousand separately lit slivers.
          // <b>Straight out of the instance matrix.</b> The compute pass builds
          // each plant's frame on the ground's normal and no longer tilts it,
          // so the up column *is* that normal, scaled by the plant's height.
          // Which means this costs nothing to carry — no extra attribute, no
          // extra buffer, no name to keep in step between two files.
          let carried = vertexInputs.world1.xyz;
          // Guard the length: a culled instance writes a zero matrix, and
          // normalising a zero vector is NaN — which spreads through the whole
          // lighting term rather than making one plant look wrong.
          let ground = select(
            vec3f(0.0, 1.0, 0.0), normalize(carried), dot(carried, carried) > 0.0001);
          let leafN = normalize(vertexOutputs.vNormalW);
          var lit = normalize(mix(leafN, ground, uniforms.bladeGround.x));
          // A backstop, an order of magnitude gentler than the clamp it
          // replaces. At any sane blend the ground already holds the normal up;
          // this only catches a leaf standing on ground steep enough to lean
          // past it.
          lit.y = max(lit.y, 0.08);
          vertexOutputs.vNormalW = normalize(lit);
        }
        {
          // <b>The root shading deepens with how enclosed the plant is.</b> The
          // compute pass writes that into the instance colour's fourth channel,
          // which was being set to one and ignored: a plant in a thick clump
          // has its neighbours over it and goes dark at the base, one on a worn
          // verge is lit all the way down. Ambient occlusion where a sward
          // actually has it, for a multiply.
          let enclosed = vertexInputs.color.a;
          let floorHere = mix(1.0, uniforms.bladeTip.w, enclosed);
          let shade = mix(floorHere, 1.0,
            bladeAlong * bladeAlong * 0.55 + bladeAlong * 0.45);
          // Per species, because a daisy's tip is white and a plantain's is
          // the same green as its root. One ramp cannot serve both.
          let toTip = mix(vec3f(1.0), uniforms.bladeTip.rgb, bladeAlong * bladeAlong);
          vertexOutputs.vColor = vec4f(
            vertexOutputs.vColor.rgb * shade * toTip, vertexOutputs.vColor.a);
        }
      `,
    };
  }
}
