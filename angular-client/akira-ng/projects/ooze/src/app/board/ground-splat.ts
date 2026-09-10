import {
  DataTexture, LinearFilter, Mesh, MeshStandardMaterial, PlaneGeometry, RGBAFormat,
  RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, Vector2, Vector3,
} from 'three';
import { SplatGround } from './board-assets';
import { BoardScene } from './board.models';
import { GroundField, groundField } from './ground-field';

/**
 * Ground made of real materials, blended by how worn it is.
 *
 * <p>One mesh and one draw call for a whole outdoor board, carrying three
 * physically-based material sets at once — lush grass, thin grass, bare dirt —
 * and choosing between them per pixel from the wear field. That is the only way
 * a dirt road can cross a meadow without a visible edge, and the edge is the
 * thing that gives a tiled board away.
 *
 * <p><b>Everything is a full PBR set, not a picture.</b> Colour, a normal map
 * and a packed ambient-occlusion/roughness/metalness map, per layer. The normal
 * map is what makes dirt read as dirt under a high sun: at one o'clock the
 * light is nearly overhead and a flat surface has almost no shading to give, so
 * every bit of shape in the ground has to come from the map.
 *
 * <p>The road also *sinks*. A cart track is lower than the grass beside it,
 * because that is what a century of cartwheels does, and a road painted flat on
 * a plane reads as a stripe no matter how good the texture is.
 */

/** How deep a fully worn rut sits below the verge, in half-feet. */
const RUT_DEPTH = 0.9;

/** Quads per half-foot along each axis. Enough to bend a rut, not a terrain. */
const MESH_DETAIL = 0.25;

export interface SplatSurface {
  readonly mesh: Mesh;
  dispose(): void;
}

export function splatGround(
  ground: SplatGround,
  board: BoardScene,
  lightUniform: { value: DataTexture | null },
  extentUniform: { value: Vector2 },
): SplatSurface {
  const field = groundField(board);
  const mask = new DataTexture(field.data, field.width, field.height, RGBAFormat);
  mask.minFilter = LinearFilter;
  mask.magFilter = LinearFilter;
  mask.needsUpdate = true;

  const loader = new TextureLoader();
  const layers = ground.layers.map(layer => ({
    colour: load(loader, layer.colour, true),
    normal: load(loader, layer.normal, false),
    arm: load(loader, layer.arm, false),
    // Half-feet across one repeat of the texture.
    repeat: layer.feet * 2,
    tint: layer.tint ?? [1, 1, 1],
  }));

  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });

  material.onBeforeCompile = shader => {
    shader.uniforms['uMask'] = { value: mask };
    shader.uniforms['uExtent'] = { value: new Vector2(board.widthHalfFeet, board.heightHalfFeet) };
    shader.uniforms['uBoardLight'] = lightUniform;
    shader.uniforms['uBoardExtent'] = extentUniform;
    shader.uniforms['uRut'] = { value: RUT_DEPTH };
    layers.forEach((layer, i) => {
      shader.uniforms[`uColour${i}`] = { value: layer.colour };
      shader.uniforms[`uNormal${i}`] = { value: layer.normal };
      shader.uniforms[`uArm${i}`] = { value: layer.arm };
      shader.uniforms[`uRepeat${i}`] = { value: layer.repeat };
      shader.uniforms[`uTint${i}`] = {
        value: new Vector3(layer.tint[0], layer.tint[1], layer.tint[2]),
      };
    });

    shader.vertexShader = `
      uniform sampler2D uMask;
      uniform vec2 uExtent;
      uniform float uRut;
      varying vec2 vGround;
      varying vec3 vBoardPos;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec3 world = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vGround = world.xy;
       // Sunk before anything downstream reads the position, so the shadow
       // pass, the normals and the light lookup all agree about where the
       // ground actually is.
       float wearHere = texture2D(uMask, world.xy / uExtent).r;
       transformed.z -= wearHere * wearHere * uRut;
       vBoardPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = `
      uniform sampler2D uMask;
      uniform vec2 uExtent;
      uniform sampler2D uBoardLight;
      uniform vec2 uBoardExtent;
      uniform sampler2D uColour0; uniform sampler2D uNormal0; uniform sampler2D uArm0;
      uniform sampler2D uColour1; uniform sampler2D uNormal1; uniform sampler2D uArm1;
      uniform sampler2D uColour2; uniform sampler2D uNormal2; uniform sampler2D uArm2;
      uniform float uRepeat0; uniform float uRepeat1; uniform float uRepeat2;
      uniform vec3 uTint0; uniform vec3 uTint1; uniform vec3 uTint2;
      varying vec2 vGround;
      varying vec3 vBoardPos;

      // Three weights from one number: lush at zero, bare at one, and the worn
      // stuff in the middle where the two would otherwise meet at a line.
      vec3 splatWeights(float wear) {
        float lush = 1.0 - smoothstep(0.10, 0.55, wear);
        float bare = smoothstep(0.45, 0.90, wear);
        float worn = max(0.0, 1.0 - lush - bare);
        float total = lush + worn + bare;
        return vec3(lush, worn, bare) / max(total, 0.0001);
      }
    ` + shader.fragmentShader
      .replace('#include <map_fragment>', `
        vec4 groundMask = texture2D(uMask, vGround / uExtent);
        vec3 w = splatWeights(groundMask.r);
        vec4 splatColour =
            vec4(uTint0, 1.0) * texture2D(uColour0, vGround / uRepeat0) * w.x
          + vec4(uTint1, 1.0) * texture2D(uColour1, vGround / uRepeat1) * w.y
          + vec4(uTint2, 1.0) * texture2D(uColour2, vGround / uRepeat2) * w.z;
        // Wet ground is darker and shinier. Both, and it has to be both: dark
        // alone reads as a stain and shiny alone reads as varnish.
        splatColour.rgb *= mix(1.0, 0.38, groundMask.g);
        // And the slow variation across the whole board, which is what stops a
        // perfectly good scan from reading as wallpaper.
        splatColour.rgb *= mix(0.84, 1.16, groundMask.b);
        diffuseColor *= splatColour;
      `)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * (
            texture2D(uArm0, vGround / uRepeat0).g * w.x
          + texture2D(uArm1, vGround / uRepeat1).g * w.y
          + texture2D(uArm2, vGround / uRepeat2).g * w.z);
        roughnessFactor = mix(roughnessFactor, 0.12, groundMask.g);
      `)
      .replace('#include <normal_fragment_maps>', `
        vec3 splatNormal =
            (texture2D(uNormal0, vGround / uRepeat0).xyz * 2.0 - 1.0) * w.x
          + (texture2D(uNormal1, vGround / uRepeat1).xyz * 2.0 - 1.0) * w.y
          + (texture2D(uNormal2, vGround / uRepeat2).xyz * 2.0 - 1.0) * w.z;
        // The plane's tangent frame is the world's, so the map's X and Y are
        // the board's X and Y and its Z is up. No TBN needed, and none of the
        // seams one would bring.
        normal = normalize(vec3(splatNormal.xy, splatNormal.z * 1.4));
      `)
      .replace('#include <aomap_fragment>', `
        float splatAo =
            texture2D(uArm0, vGround / uRepeat0).r * w.x
          + texture2D(uArm1, vGround / uRepeat1).r * w.y
          + texture2D(uArm2, vGround / uRepeat2).r * w.z;
        reflectedLight.indirectDiffuse *= splatAo;
      `)
      .replace('#include <tonemapping_fragment>', `
        gl_FragColor.rgb *= texture2D(uBoardLight, vBoardPos.xy / uBoardExtent).rgb * 2.0;
        #include <tonemapping_fragment>
      `);
  };
  material.customProgramCacheKey = () => 'board-splat-ground';

  const mesh = new Mesh(
    new PlaneGeometry(
      board.widthHalfFeet,
      board.heightHalfFeet,
      Math.max(1, Math.round(board.widthHalfFeet * MESH_DETAIL)),
      Math.max(1, Math.round(board.heightHalfFeet * MESH_DETAIL)),
    ),
    material,
  );
  // PlaneGeometry is built around the origin in XY, which is already this
  // world's ground plane — no rotation, only a shift to put its corner at 0.
  mesh.position.set(board.widthHalfFeet / 2, board.heightHalfFeet / 2, 0);
  mesh.receiveShadow = true;

  return {
    mesh,
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      mask.dispose();
      layers.forEach(layer => {
        layer.colour.dispose();
        layer.normal.dispose();
        layer.arm.dispose();
      });
    },
  };
}

/**
 * One map, tiling.
 *
 * <p>Colour maps are sRGB and the other two are not, and getting that backwards
 * is the classic way to end up with washed-out ground and normals that bend the
 * wrong way: a normal map is a direction encoded as a colour, not a colour.
 */
function load(loader: TextureLoader, url: string, isColour: boolean): Texture {
  const texture = loader.load(new URL(url, import.meta.url).href);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  if (isColour) {
    texture.colorSpace = SRGBColorSpace;
  }
  // Sixteen taps rather than the default, because this ground is seen at a
  // glancing angle across its whole depth — which is exactly where an
  // un-anisotropic texture turns to mush a few feet from the camera.
  texture.anisotropy = 16;
  return texture;
}

export type { GroundField };
