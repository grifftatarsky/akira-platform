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
      CUSTOM_VERTEX_UPDATE_POSITION: `
        var bladeAlong = vertexInputs.uv.y;
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
          let sink = 1.0 - over * over * 0.18 * bladeAlong;
          positionUpdated = vec3f(
            positionUpdated.x + curve.x * dot(downwind, sideways),
            positionUpdated.y * sink,
            positionUpdated.z + curve.x * dot(downwind, facing));
        }
      `,

      // <b>Dark at the ground, pale at the tip.</b> Light does not reach the
      // bottom of a sward — there is a foot of grass above it — and the tips
      // are drier and thinner and let more through. Two lines, and it is the
      // difference between a field and a green carpet.
      CUSTOM_VERTEX_MAIN_END: `
        {
          // <b>Hold the world normal above the horizon.</b> The geometry's own
          // normals are already lifted, but that is done in the plant's local
          // space and the instance matrix then leans the whole plant by up to
          // a quarter turn — which carries a normal set twenty degrees up to
          // several degrees down. A normal pointing at the ground takes the
          // hemispheric light's ground colour, a dark brown that reads as
          // black, and it does so whether the sun is up or not.
          //
          // <p>Clamping here rather than in the geometry is the only place it
          // is exact, because here the lean has already happened.
          var lit = vertexOutputs.vNormalW;
          lit.y = max(lit.y, 0.22);
          vertexOutputs.vNormalW = normalize(lit);
        }
        {
          let shade = mix(uniforms.bladeTip.w, 1.0,
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
