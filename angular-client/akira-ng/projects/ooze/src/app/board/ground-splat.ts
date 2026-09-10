import {
  DataTexture, LinearFilter, Mesh, MeshStandardMaterial, PlaneGeometry, RGBAFormat,
  RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, Vector2, Vector3,
} from 'three';
import { SplatGround } from './board-assets';
import { BoardScene } from './board.models';
import { GroundField, groundField, heightAt } from './ground-field';

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

/**
 * Sampling a tiling texture so that it stops looking like one.
 *
 * <p><b>The problem is not the texture, it is the lattice.</b> A scan repeats
 * every few feet by construction, and an eye finds a repeating arrangement long
 * before it finds a repeating detail — so a perfectly good photograph of grass
 * reads as wallpaper the moment you can see a dozen copies of it at once. No
 * amount of resolution fixes that; more resolution just makes a bigger tile.
 *
 * <p>So the ground is not sampled on a square lattice at all. Every point falls
 * inside a triangle of an equilateral grid, its three corners each carry a
 * random offset derived from where they are, and the texture is read three
 * times — once per corner, each somewhere else in the image — then blended by
 * how close the point is to each. The offsets never repeat, so the *arrangement*
 * never repeats, while every pixel is still real measured ground.
 *
 * <p><b>The blend is sharpened rather than variance-preserving.</b> Three
 * samples averaged flatly regress toward the texture's mean and turn grass to
 * porridge where cells meet, which is what the reference's variance term is
 * for — but that term restores contrast by scaling each sample's deviation
 * from an assumed *grey* mean, and grass is not grey. It amplified the wrong
 * thing and drew the honeycomb it existed to hide. Cubing the weights instead
 * lets one sample dominate almost everywhere and confines blending to a narrow
 * band along each edge: no mush, and nothing regular enough to see.
 *
 * <p>After Heitz and Neyret's by-example noise, minus the histogram transform —
 * the rigorous version needs a precomputed lookup per texture and buys less
 * here than a fourth material layer would.
 */
const STOCHASTIC = `
  vec2 splatHash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  // The triangle a point lands in, as three corners and their weights.
  void splatGrid(vec2 uv, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3) {
    // One triangle to roughly one tile of the texture. The reference uses
    // 2*sqrt(3), which puts three cells inside every tile — and at that size
    // the *grid* becomes the pattern: a honeycomb across the whole meadow,
    // trading one visible lattice for another. Cells about a tile across mean
    // most of what you see is one continuous piece of the scan.
    vec2 skewed = mat2(1.0, 0.0, -0.57735027, 1.15470054) * uv;
    vec2 base = floor(skewed);
    vec3 t = vec3(fract(skewed), 0.0);
    t.z = 1.0 - t.x - t.y;
    if (t.z > 0.0) {
      w = vec3(t.z, t.y, t.x);
      v1 = base;
      v2 = base + vec2(0.0, 1.0);
      v3 = base + vec2(1.0, 0.0);
    } else {
      w = vec3(-t.z, 1.0 - t.y, 1.0 - t.x);
      v1 = base + vec2(1.0, 1.0);
      v2 = base + vec2(1.0, 0.0);
      v3 = base + vec2(0.0, 1.0);
    }
  }

  void splatLayer(
    sampler2D colourMap, sampler2D normalMap, sampler2D armMap, vec2 uv,
    out vec4 outColour, out vec3 outNormal, out vec3 outArm
  ) {
    vec3 w; vec2 v1; vec2 v2; vec2 v3;
    splatGrid(uv, w, v1, v2, v3);
    // The offsets are constant within a triangle, so all three reads share the
    // point's derivatives and land on the same mip. Only the quads straddling
    // a triangle edge see a jump, and there it costs a pixel of extra blur —
    // which is a far better trade than a visible grid.
    vec2 o1 = splatHash(v1);
    vec2 o2 = splatHash(v2);
    vec2 o3 = splatHash(v3);

    // Sharpened, so one sample dominates almost everywhere and the blend is
    // confined to a narrow band along each edge. This replaced the reference's
    // variance-preserving blend, which restores contrast by scaling each
    // sample's deviation from the texture's *mean* — and assuming that mean is
    // grey, which grass is emphatically not. On this ground it amplified the
    // wrong thing and drew the grid it was supposed to hide.
    vec3 sharp = w * w * w;
    sharp /= max(sharp.x + sharp.y + sharp.z, 0.0001);

    outColour =
        texture2D(colourMap, uv + o1) * sharp.x
      + texture2D(colourMap, uv + o2) * sharp.y
      + texture2D(colourMap, uv + o3) * sharp.z;

    outNormal =
        (texture2D(normalMap, uv + o1).xyz * 2.0 - 1.0) * sharp.x
      + (texture2D(normalMap, uv + o2).xyz * 2.0 - 1.0) * sharp.y
      + (texture2D(normalMap, uv + o3).xyz * 2.0 - 1.0) * sharp.z;

    outArm =
        texture2D(armMap, uv + o1).xyz * sharp.x
      + texture2D(armMap, uv + o2).xyz * sharp.y
      + texture2D(armMap, uv + o3).xyz * sharp.z;
  }
`;

/**
 * Vertices per half-foot along each axis.
 *
 * <p>One, so the mesh can carry unevenness at the scale a foot of ground
 * actually has it. A 220-by-150-foot board is about a quarter of a million
 * triangles, which is a rounding error next to what a single photogrammetry
 * tuft of grass was costing — and it buys real shape rather than a picture of
 * shape.
 */
const MESH_DETAIL = 1;

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
      varying vec2 vGround;
      varying vec3 vBoardPos;
      varying vec3 vGroundNormal;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       // The shape is already in the geometry — displaced once on the way in,
       // with its normals recomputed from the result. Doing it here instead
       // would leave every normal pointing straight up at ground the shader
       // had just bent, which is a flat-looking hill.
       vBoardPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vGround = vBoardPos.xy;
       vGroundNormal = normalize(mat3(modelMatrix) * normal);`);

    shader.fragmentShader = `
      uniform sampler2D uMask;
      uniform vec2 uExtent;
      varying vec3 vGroundNormal;
      uniform sampler2D uBoardLight;
      uniform vec2 uBoardExtent;
      uniform sampler2D uColour0; uniform sampler2D uNormal0; uniform sampler2D uArm0;
      uniform sampler2D uColour1; uniform sampler2D uNormal1; uniform sampler2D uArm1;
      uniform sampler2D uColour2; uniform sampler2D uNormal2; uniform sampler2D uArm2;
      uniform float uRepeat0; uniform float uRepeat1; uniform float uRepeat2;
      uniform vec3 uTint0; uniform vec3 uTint1; uniform vec3 uTint2;
      varying vec2 vGround;
      varying vec3 vBoardPos;

      ${STOCHASTIC}

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
        vec3 lw = splatWeights(groundMask.r);

        // Sampled once for the whole material and shared by every chunk below.
        // Each layer is nine texture reads, so gathering them here rather than
        // per chunk is the difference between nine and thirty-six.
        vec4 layerColour = vec4(0.0);
        vec3 layerNormal = vec3(0.0);
        vec3 layerArm = vec3(0.0);
        vec4 c; vec3 n; vec3 a;

        // Skipped where a layer contributes nothing, which is most fragments:
        // the middle of the road is bare and the meadow is lush, and only the
        // verge is a mixture. Branching here cuts the common case to a third.
        if (lw.x > 0.002) {
          splatLayer(uColour0, uNormal0, uArm0, vGround / uRepeat0, c, n, a);
          layerColour += vec4(uTint0, 1.0) * c * lw.x;
          layerNormal += n * lw.x;
          layerArm += a * lw.x;
        }
        if (lw.y > 0.002) {
          splatLayer(uColour1, uNormal1, uArm1, vGround / uRepeat1, c, n, a);
          layerColour += vec4(uTint1, 1.0) * c * lw.y;
          layerNormal += n * lw.y;
          layerArm += a * lw.y;
        }
        if (lw.z > 0.002) {
          splatLayer(uColour2, uNormal2, uArm2, vGround / uRepeat2, c, n, a);
          layerColour += vec4(uTint2, 1.0) * c * lw.z;
          layerNormal += n * lw.z;
          layerArm += a * lw.z;
        }

        // Wet ground is darker and shinier. Both, and it has to be both: dark
        // alone reads as a stain and shiny alone reads as varnish.
        layerColour.rgb *= mix(1.0, 0.38, groundMask.g);
        // And the slow variation across the whole board, which is what stops a
        // perfectly good scan from reading as wallpaper.
        layerColour.rgb *= mix(0.84, 1.16, groundMask.b);
        diffuseColor *= layerColour;
      `)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * layerArm.g;
        roughnessFactor = mix(roughnessFactor, 0.12, groundMask.g);
      `)
      .replace('#include <normal_fragment_maps>', `
        // A real tangent frame, built from the surface the ground actually has.
        //
        // This used to hand the tangent-space normal straight to three as if it
        // were the shading normal, which is wrong twice over: three's is in
        // *view* space, and the surface is no longer flat, so "up" is not up.
        // On a flat plane under a top-down camera the error was invisible; on
        // ground with shape in it, every slope would have been lit as if level.
        //
        // The UVs run along world X and Y, so the tangent is world X projected
        // onto the surface and the bitangent follows.
        vec3 gN = normalize(vGroundNormal);
        vec3 gT = normalize(vec3(1.0, 0.0, 0.0) - gN * gN.x);
        vec3 gB = cross(gN, gT);
        // Pushed harder than the scan measured. A surface lit from seventy
        // degrees up returns almost the same amount of light whichever way it
        // faces, so at noon the relief has to be exaggerated to be seen at all
        // — the sun is the thing flattening this ground, not the maps.
        vec3 detail = normalize(vec3(layerNormal.xy * 1.9, layerNormal.z));
        vec3 worldNormal = normalize(gT * detail.x + gB * detail.y + gN * detail.z);
        normal = normalize((viewMatrix * vec4(worldNormal, 0.0)).xyz);
      `)
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse *= layerArm.r;
      `)
      .replace('#include <tonemapping_fragment>', `
        gl_FragColor.rgb *= texture2D(uBoardLight, vBoardPos.xy / uBoardExtent).rgb * 2.0;
        #include <tonemapping_fragment>
      `);
  };
  material.customProgramCacheKey = () => 'board-splat-ground';

  const geometry = new PlaneGeometry(
    board.widthHalfFeet,
    board.heightHalfFeet,
    Math.max(1, Math.round(board.widthHalfFeet * MESH_DETAIL)),
    Math.max(1, Math.round(board.heightHalfFeet * MESH_DETAIL)),
  );
  displace(geometry, field, board);

  const mesh = new Mesh(geometry, material);
  // PlaneGeometry is built around the origin in XY, which is already this
  // world's ground plane — no rotation, only a shift to put its corner at 0.
  mesh.position.set(board.widthHalfFeet / 2, board.heightHalfFeet / 2, 0);
  mesh.receiveShadow = true;
  // And casts, now that it has shape: a rise catching the afternoon sun should
  // put its own far side in shadow, which is half of why shape reads as shape.
  mesh.castShadow = true;

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
 * Bends a flat grid into the ground the field describes.
 *
 * <p>On the way in rather than in the vertex shader, and that is the whole
 * point: normals recomputed from the displaced positions mean every slope is
 * lit as the slope it is. Displacing in the shader leaves the normals pointing
 * straight up at ground that is no longer flat — a hill you can see the
 * silhouette of and cannot see the shading of.
 */
function displace(
  geometry: PlaneGeometry,
  field: GroundField,
  board: BoardScene,
): void {
  const position = geometry.getAttribute('position');
  const halfWidth = board.widthHalfFeet / 2;
  const halfHeight = board.heightHalfFeet / 2;
  for (let i = 0; i < position.count; i++) {
    // The geometry is centred on the origin and the field is not, so the
    // sample point is the vertex shifted by half the board.
    position.setZ(i, heightAt(
      field,
      position.getX(i) + halfWidth,
      position.getY(i) + halfHeight));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
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
