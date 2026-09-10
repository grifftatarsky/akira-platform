import { ShaderMaterial, Vector3 } from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * The last thing that happens to the picture.
 *
 * <p>Tone mapping decides how much light there is; this decides what it looks
 * like. They are separate jobs and it matters that they are: the curve has to
 * stay faithful so a torch reads as brighter than a lamp, while the grade is
 * free to be opinionated, because "a dungeon should be warm and a little
 * contrasty" is a taste and not a measurement.
 *
 * <p>Deliberately small. Saturation, contrast, a warm bias and a vignette are
 * four knobs that between them do most of what a color grade does, and a LUT —
 * the professional answer — is a texture to source, ship and keep in step with
 * a look nobody has settled on yet.
 *
 * <p>Runs after the output pass, so it works in display space rather than in
 * linear radiance. That is the right place for it: these are adjustments to a
 * picture, not to an amount of light, and doing them in linear would make the
 * contrast curve pivot somewhere no eye agrees with.
 */
export function gradePass(): ShaderPass {
  return new ShaderPass(new ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      // A dungeon lit by fire is a saturated place, and a faithful tone curve
      // gives back exactly what was there — which is a touch anaemic next to
      // the reference. A sixth again is the difference between "correct" and
      // "painted".
      saturation: { value: 1.16 },
      contrast: { value: 1.06 },
      // Warm, and barely. Enough that the whole image agrees with the
      // torchlight in it rather than arguing with it.
      tint: { value: new Vector3(1.03, 1.0, 0.96) },
      vignette: { value: 0.34 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float saturation;
      uniform float contrast;
      uniform vec3 tint;
      uniform float vignette;
      varying vec2 vUv;

      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        vec3 color = texel.rgb;

        // Rec. 709 luma, not a flat average of the channels: the eye weighs
        // green far more than blue, and desaturating by the average turns a
        // warm scene muddy on its way to grey.
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luma), color, saturation);

        color = (color - 0.5) * contrast + 0.5;
        color *= tint;

        // Distance to the corner rather than to the edge, so the darkening is
        // round and does not track the shape of the window.
        float radius = length(vUv - 0.5) * 1.4142;
        color *= 1.0 - vignette * smoothstep(0.5, 1.0, radius);

        gl_FragColor = vec4(max(color, 0.0), texel.a);
      }`,
  }));
}
