import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

/**
 * Wind, in the vertex shader, bending the blade along its length.
 *
 * <p>It used to be in the compute pass: the whole meadow re-sown every frame
 * with a new lean baked into each instance matrix. That kept the material
 * completely stock, which was the point — but it meant six hundred thousand
 * threads writing thirty-eight megabytes a frame to move some grass, and a
 * matrix can only turn a blade rigidly about its root. Real grass bends.
 *
 * <p>So the placement is computed once and this moves it. The compute pass now
 * runs when the density changes and not otherwise.
 *
 * <p><b>The bend has to be in a consistent world direction.</b> Each blade is
 * rotated to its own facing by its instance matrix, so pushing it along a
 * local axis would have every blade lean whichever way it happened to be
 * pointing — which is not wind, it is a field having a seizure. The matrix's
 * own columns say where the blade's local axes ended up in the world, so the
 * wind vector is projected onto them and the blade leans downwind whatever way
 * it faces.
 */
export class BladeWind extends MaterialPluginBase {

  /** Seconds. The only thing that changes per frame. */
  time = 0;
  /** Downwind direction across the board, and how hard it blows. */
  eastward = 0.82;
  northward = 0.57;
  strength = 1.35;

  constructor(material: Material) {
    // After 200, which puts it past the stock vertex work it depends on.
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
    return { ubo: [{ name: 'bladeWind', size: 4, type: 'vec4' }] };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat4(
      'bladeWind', this.eastward, this.northward, this.strength, this.time,
    );
  }

  override getCustomCode(
    shaderType: string, shaderLanguage?: ShaderLanguage,
  ): Record<string, string> | null {
    if (shaderType !== 'vertex' || shaderLanguage !== ShaderLanguage.WGSL) {
      return null;
    }
    return {
      CUSTOM_VERTEX_UPDATE_POSITION: `
        {
          // Height up the blade. The root does not move and the tip moves
          // most, which is the difference between grass bending and grass
          // sliding.
          let along = vertexInputs.uv.y;
          let root = vertexInputs.world3.xyz;

          // Three waves at unrelated angles and speeds. One travelling sine is
          // a bar crossing the field with every blade in it leaning together.
          let t = uniforms.bladeWind.w;
          let w1 = sin(dot(root.xz, vec2f(0.021, 0.013)) - t * 1.5);
          let w2 = sin(dot(root.xz, vec2f(-0.009, 0.026)) - t * 0.9 + 2.1);
          let w3 = sin(dot(root.xz, vec2f(0.041, -0.031)) - t * 2.7 + 4.3);
          let gust = 0.5 + 0.5 * (w1 * 0.55 + w2 * 0.3 + w3 * 0.15);

          let bend = uniforms.bladeWind.z * gust * along * along;
          let downwind = vec3f(uniforms.bladeWind.x, 0.0, uniforms.bladeWind.y);
          // Where this blade's local axes point in the world, so the lean is
          // downwind rather than whichever way the blade happens to face.
          let sideways = normalize(vertexInputs.world0.xyz);
          let facing = normalize(vertexInputs.world2.xyz);
          positionUpdated.x += bend * dot(downwind, sideways);
          positionUpdated.z += bend * dot(downwind, facing);
        }
      `,
    };
  }
}
