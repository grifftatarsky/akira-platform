import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

export class BladeWind extends MaterialPluginBase {
  time = 0;

  eastward = 0.82;
  northward = 0.57;
  strength = 1.35;

  tip: [number, number, number] = [1.2, 1.18, 0.98];
  floor = 0.28;

  ground = 0.8;

  droop = 0;

  patchSize = 1;
  gustBias = 0;

  tall = 1;

  constructor(material: Material) {
    super(material, 'BladeWind', 200, { BLADE_WIND: true });
    this._enable(true);
  }

  override getClassName(): string {
    return 'BladeWind';
  }

  override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.WGSL;
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
    uniformBuffer.updateFloat4(
      'bladeGround', this.ground, this.droop,
      Math.max(0.05, this.patchSize), this.gustBias,
    );
    uniformBuffer.updateFloat4('bladeTall', Math.max(0.05, this.tall), 0, 0, 0);
  }

  override getCustomCode(
    shaderType: string, shaderLanguage?: ShaderLanguage,
  ): Record<string, string> | null {
    if (shaderType !== 'vertex' || shaderLanguage !== ShaderLanguage.WGSL) {
      return null;
    }
    return {
      CUSTOM_VERTEX_UPDATE_POSITION: `
        var bladeAlong = clamp(positionUpdated.y / uniforms.bladeTall.x, 0.0, 1.0);
        {
          let root = vertexInputs.world3.xyz;

          let root2 = floor(vertexInputs.world3.xz * 8.0);
          var hashed = (u32(abs(root2.x) + 4096.0) * 73856093u)
            ^ (u32(abs(root2.y) + 4096.0) * 19349663u);
          hashed ^= hashed >> 13u;
          hashed *= 0x5bd1e995u;
          hashed ^= hashed >> 15u;
          let dice = f32(hashed & 0xffffffu) / 16777216.0;
          let t = uniforms.bladeWind.w;
          let downwind2 = normalize(vec2f(uniforms.bladeWind.x, uniforms.bladeWind.y));
          let drift = root.xz - downwind2 * t * 11.0;
          let slow = root.xz - downwind2 * t * 14.0;

          let grain = 1.0 / uniforms.bladeGround.z;
          let f1 = sin(dot(drift, vec2f(0.076, 0.048) * grain));
          let f2 = sin(dot(drift, vec2f(-0.032, 0.092) * grain) + 2.1);
          let f3 = sin(dot(slow, vec2f(0.0136, 0.0102) * grain) + 4.3);
          let gustField = f1 * 0.5 + f2 * 0.5 + uniforms.bladeGround.w;
          let weather = 0.5 + 0.5 * f3;

          let gust = smoothstep(-0.9, 0.5, gustField) * (0.25 + 0.75 * weather);
          let flutter = sin(t * (5.0 + 5.0 * dice) + dice * 37.0) * 0.16 * gust;
          let over = min(1.6, uniforms.bladeWind.z * (0.08 + 1.35 * gust + flutter));

          let c1 = vec2f(over * 0.10, 0.55);
          let c2 = vec2f(over * 0.72, max(0.2, 1.0 - over * over * 0.22));
          let m1 = mix(vec2f(0.0, 0.0), c1, bladeAlong);
          let m2 = mix(c1, c2, bladeAlong);
          let curve = mix(m1, m2, bladeAlong);

          let sideways = normalize(vertexInputs.world0.xyz);
          let facing = normalize(vertexInputs.world2.xyz);
          let downwind = vec3f(uniforms.bladeWind.x, 0.0, uniforms.bladeWind.y);

          let curl = uniforms.bladeGround.y * (0.35 + 0.65 * dice);
          let arc = positionUpdated.y;
          let turned = clamp(curl * arc, -1.5, 1.5);
          let straight = curl < 0.0001;
          let rise = select(sin(turned) / curl, arc, straight);
          let reach = select((1.0 - cos(turned)) / curl, 0.0, straight);

          let sink = max(0.2, 1.0 - over * over * 0.18 * bladeAlong);
          positionUpdated = vec3f(
            positionUpdated.x + curve.x * dot(downwind, sideways),
            rise * sink,
            positionUpdated.z + curve.x * dot(downwind, facing) + reach);
        }
      `,

      CUSTOM_VERTEX_MAIN_END: `
        {
          let carried = vertexInputs.world1.xyz;
          let ground = select(
            vec3f(0.0, 1.0, 0.0), normalize(carried), dot(carried, carried) > 0.0001);
          let leafN = normalize(vertexOutputs.vNormalW);
          var lit = normalize(mix(leafN, ground, uniforms.bladeGround.x));
          lit.y = max(lit.y, 0.08);
          vertexOutputs.vNormalW = normalize(lit);
        }
        {
          let enclosed = vertexInputs.color.a;
          let floorHere = mix(1.0, uniforms.bladeTip.w, enclosed);
          let shade = mix(floorHere, 1.0,
            bladeAlong * bladeAlong * 0.55 + bladeAlong * 0.45);
          let toTip = mix(vec3f(1.0), uniforms.bladeTip.rgb, bladeAlong * bladeAlong);
          vertexOutputs.vColor = vec4f(
            vertexOutputs.vColor.rgb * shade * toTip, vertexOutputs.vColor.a);
        }
      `,
    };
  }
}
