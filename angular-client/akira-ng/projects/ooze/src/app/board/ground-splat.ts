import {
  DataArrayTexture, DataTexture, LinearFilter, Mesh, MeshStandardMaterial, PlaneGeometry, RGBAFormat,
  RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, Vector2, Vector3,
} from 'three';
import { SplatGround } from './board-assets';
import { BoardScene } from './board.models';
import { GroundField, groundField, heightAt } from './ground-field';
import {
  GROUND_HEIGHT_BLEND, GROUND_SAMPLING, GROUND_TINT, GROUND_VARIANTS,
} from './ground-shader';
import { loadTextureArray } from './texture-array';

/**
 * Ground made of real materials, blended by how worn it is.
 *
 * <p>One mesh and one draw call for a whole outdoor board, carrying three
 * physically-based material sets at once — lush grass, thin grass, bare dirt —
 * and choosing between them per pixel from the wear field. That is the only way
 * a dirt road can cross a meadow without a visible edge, and the edge is the
 * thing that gives a tiled board away.
 *
 * <p><b>Everything is a full PBR set, not a picture.</b> Color, a normal map
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
    sampler2D colorMap, sampler2D normalMap, sampler2D armMap, vec2 uv,
    out vec4 outColor, out vec3 outNormal, out vec3 outArm
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

    outColor =
        texture2D(colorMap, uv + o1) * sharp.x
      + texture2D(colorMap, uv + o2) * sharp.y
      + texture2D(colorMap, uv + o3) * sharp.z;

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
 * <p>Two, so a vertex every three inches: the scale a wheel rut, a hoofprint
 * and a clod of a driven road actually vary at. One was enough for a meadow
 * and visibly not enough for the road, which was the point of the road — the
 * field underneath describes prints and ruts and a mesh that samples every six
 * inches averages them into a gentle wobble.
 *
 * <p>A 220-by-150-foot board is about a million triangles at this density.
 * Measured rather than assumed to be affordable, and it is: shape is what the
 * light has to work with, and there is no texture that substitutes for it.
 *
 * <p>Exported because the grass has to root itself on the surface this makes,
 * and that surface is the *interpolation* between these vertices rather than
 * the field's own value — see {@link ../grass-blades}.
 */
export const MESH_DETAIL = 2;

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
  // Several photographs per layer, each set in one binding. Loaded after the
  // material is built, because each has to be decoded through a canvas and
  // there is no sense holding the whole board up for it — until they land a
  // layer draws from its single `color` map, which is what it did before.
  const variants = ground.layers.map(layer => {
    const slot: {
      texture: { value: DataArrayTexture | null };
      count: { value: number };
      declared: boolean;
    } = { texture: { value: null }, count: { value: 1 }, declared: !!layer.variants?.length };
    if (layer.variants?.length) {
      void loadTextureArray(layer.variants, true, true).then(array => {
        if (array) {
          slot.texture.value = array;
          slot.count.value = array.image.depth;
        }
      });
    }
    return slot;
  });
  const field = groundField(board);
  const mask = new DataTexture(field.data, field.width, field.height, RGBAFormat);
  mask.minFilter = LinearFilter;
  mask.magFilter = LinearFilter;
  mask.needsUpdate = true;

  const loader = new TextureLoader();
  const layers = ground.layers.map(layer => ({
    color: load(loader, layer.color, true),
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
    variants.forEach((slot, i) => {
      if (!slot.declared) {
        return;
      }
      shader.uniforms[`uVariants${i}`] = slot.texture;
      shader.uniforms[`uVariantCount${i}`] = slot.count;
    });
    layers.forEach((layer, i) => {
      shader.uniforms[`uColor${i}`] = { value: layer.color };
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
      uniform sampler2D uBoardLight;
      uniform vec2 uBoardExtent;
      uniform sampler2D uColor0; uniform sampler2D uNormal0; uniform sampler2D uArm0;
      uniform sampler2D uColor1; uniform sampler2D uNormal1; uniform sampler2D uArm1;
      uniform sampler2D uColor2; uniform sampler2D uNormal2; uniform sampler2D uArm2;
      uniform float uRepeat0; uniform float uRepeat1; uniform float uRepeat2;
      uniform vec3 uTint0; uniform vec3 uTint1; uniform vec3 uTint2;
      ${variants.map((slot, i) => slot.declared
        ? `uniform sampler2DArray uVariants${i}; uniform float uVariantCount${i};`
        : '').join('\n      ')}
      varying vec2 vGround;
      varying vec3 vBoardPos;
      varying vec3 vGroundNormal;

      ${GROUND_SAMPLING}
      ${GROUND_VARIANTS}
      ${GROUND_HEIGHT_BLEND}
      ${GROUND_TINT}

      // Where the coarser scale starts and finishes taking over, measured in
      // texture repeats per screen pixel.
      //
      // <p>Not distance from the camera, which was the obvious thing and the
      // wrong one: what actually breaks a texture down is how many of its
      // repeats land inside one pixel, and that depends on the zoom, the
      // projection and the angle of the ground as much as on range. A
      // top-down orthographic board sixty feet up and a perspective camera
      // six feet up can want the same scale. Repeats-per-pixel is the
      // quantity itself, so the crossover is right at every zoom without a
      // number tuned per camera.
      //
      // <p>A repeat spanning 128 pixels still has detail to give; by 32 it is
      // averaging most of the photograph into every pixel.
      const float FINE_PIXELS = 1.0 / 128.0;
      const float COARSE_PIXELS = 1.0 / 32.0;

      // How much bigger the far read's world footprint is. Enough that a
      // repeat is a body-length rather than a hand-span; more than about four
      // and the ground turns into weather.
      const float COARSE = 3.5;

      // One sampler per layer, generated rather than parameterised: which
      // binding a layer reads from is a property of the theme, known when the
      // shader is built, and passing a sampler around as an argument is
      // exactly what GLSL will not let you do.
      ${layers.map((_, i) => {
        const pick = variants[i].declared
          ? (cell: string) =>
              `grassVariant(uVariants${i}, uv, ${cell}, uVariantCount${i}, dx, dy)`
          : (cell: string) => `groundVariant(uColor${i}, uv, ${cell}, dx, dy)`;
        return `
      vec4 stochasticColor${i}(vec2 uv) {
        vec3 w; vec2 v1; vec2 v2; vec2 v3;
        groundGrid(uv, w, v1, v2, v3);
        vec3 s = groundSharpen(w);
        vec2 dx = dFdx(uv);
        vec2 dy = dFdy(uv);
        return ${pick('v1')} * s.x
             + ${pick('v2')} * s.y
             + ${pick('v3')} * s.z;
      }

      /**
       * The same layer read at two world scales and crossed over with distance.
       *
       * <p>A texture sized to read as blades underfoot has nothing left at
       * sixty feet: the repeat is a few pixels wide, so every screen pixel is
       * an average of the whole photograph and the far half of the board goes
       * to flat mush — the exact failure a sharper texture makes worse rather
       * than better. Read at several times the footprint, the same photograph
       * is back in its useful mip range at that distance and carries clumps
       * and patches instead. Near ground keeps the fine read, far ground gets
       * the coarse one, and the crossover is wide enough that nothing moves
       * through a visible line as the camera pulls back.
       */
      vec4 scaledColor${i}(vec2 uv, float far) {
        vec4 near = stochasticColor${i}(uv);
        if (far < 0.004) {
          return near;
        }
        return mix(near, stochasticColor${i}(uv / COARSE), far);
      }

      // One layer, whole: color at two scales, relief and occlusion at one.
      // The normal and the packed map are deliberately not blended across
      // scales — at the distance where the coarse color matters, a bump the
      // size of a blade of grass is well under a pixel and paying for it twice
      // buys nothing.
      void sampleLayer${i}(vec2 uv, float far, out vec4 outColor, out vec3 outNormal,
                           out vec3 outArm) {
        vec3 w; vec2 v1; vec2 v2; vec2 v3;
        groundGrid(uv, w, v1, v2, v3);
        vec3 s = groundSharpen(w);
        vec2 dx = dFdx(uv);
        vec2 dy = dFdy(uv);

        outColor = scaledColor${i}(uv, far);

        outNormal =
            (groundVariant(uNormal${i}, uv, v1, dx, dy).xyz * 2.0 - 1.0) * s.x
          + (groundVariant(uNormal${i}, uv, v2, dx, dy).xyz * 2.0 - 1.0) * s.y
          + (groundVariant(uNormal${i}, uv, v3, dx, dy).xyz * 2.0 - 1.0) * s.z;

        outArm =
            groundVariant(uArm${i}, uv, v1, dx, dy).xyz * s.x
          + groundVariant(uArm${i}, uv, v2, dx, dy).xyz * s.y
          + groundVariant(uArm${i}, uv, v3, dx, dy).xyz * s.z;
      }`;
      }).join('\n')}
    ` + shader.fragmentShader
      .replace('#include <map_fragment>', `
        vec4 groundMask = texture2D(uMask, vGround / uExtent);

        vec4 c0 = vec4(0.0); vec3 n0 = vec3(0.0, 0.0, 1.0); vec3 a0 = vec3(1.0, 0.9, 0.0);
        vec4 c1 = vec4(0.0); vec3 n1 = vec3(0.0, 0.0, 1.0); vec3 a1 = vec3(1.0, 0.9, 0.0);
        vec4 c2 = vec4(0.0); vec3 n2 = vec3(0.0, 0.0, 1.0); vec3 a2 = vec3(1.0, 0.9, 0.0);

        // Which layers are worth sampling at all. The middle of the road is
        // bare and the meadow is lush; only the verge is a mixture, so most
        // fragments pay for one layer rather than three.
        float lush = 1.0 - smoothstep(0.10, 0.55, groundMask.r);
        float bare = smoothstep(0.45, 0.90, groundMask.r);
        float worn = max(0.0, 1.0 - lush - bare);

        // How much of one repeat of the base layer falls inside this pixel.
        vec2 fine = vGround / uRepeat0;
        float density = max(length(dFdx(fine)), length(dFdy(fine)));
        float far = smoothstep(FINE_PIXELS, COARSE_PIXELS, density);

        if (lush > 0.002) { sampleLayer0(vGround / uRepeat0, far, c0, n0, a0); }
        if (worn > 0.002) { sampleLayer1(vGround / uRepeat1, far, c1, n1, a1); }
        if (bare > 0.002) { sampleLayer2(vGround / uRepeat2, far, c2, n2, a2); }

        // Blended by relief rather than cross-faded, so grass stands proud into
        // the bare ground at the verge instead of dissolving into it. The red
        // channel of the packed map is ambient occlusion, which stands in for
        // height: what is buried is what is dark.
        vec3 lw = heightBlend(vec3(lush, worn, bare), vec3(a0.r, a1.r, a2.r));

        vec4 layerColor =
            vec4(uTint0, 1.0) * c0 * lw.x
          + vec4(uTint1, 1.0) * c1 * lw.y
          + vec4(uTint2, 1.0) * c2 * lw.z;
        vec3 layerNormal = n0 * lw.x + n1 * lw.y + n2 * lw.z;
        vec3 layerArm = a0 * lw.x + a1 * lw.y + a2 * lw.z;

        // A second, much finer read of the same relief. Two frequencies beat
        // against each other and never line up, and it is what holds up when
        // the camera comes down close — where the base scale is a few pixels
        // per blade and has nothing left to give.
        vec3 detail = groundVariant(uNormal0, vGround / (uRepeat0 * 0.22),
          floor(vGround / (uRepeat0 * 0.22)), dFdx(vGround / (uRepeat0 * 0.22)),
          dFdy(vGround / (uRepeat0 * 0.22))).xyz * 2.0 - 1.0;
        layerNormal = normalize(layerNormal + vec3(detail.xy * 0.55, 0.0));

        // Wet ground is darker and shinier. Both, and it has to be both: dark
        // alone reads as a stain and shiny alone reads as varnish. Not as dark
        // as it was: at 0.38 the ruts read as tar rather than as clay holding
        // water, and the wetness now comes from the shape rather than from a
        // painted MUD square, so it covers far more of the road.
        layerColor.rgb *= mix(1.0, 0.55, groundMask.g);
        // Slow variation across the whole board — hue as well as brightness,
        // because ground is not one color and a texture that is reads as one.
        float macro = groundMask.b;
        layerColor.rgb = shiftColor(
          layerColor.rgb,
          (macro - 0.5) * 0.30,
          mix(0.86, 1.14, macro),
          mix(0.82, 1.18, macro));
        diffuseColor *= layerColor;
      `)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * layerArm.g;
        // Wet clay, not glass. At 0.12 the sun put a mirror highlight down the
        // ruts and the bloom pass turned it into a white sheet — that number
        // is for standing water, and this is ground with water in it.
        roughnessFactor = mix(roughnessFactor, 0.34, groundMask.g);
      `)
      .replace('#include <normal_fragment_maps>', `
        // A real tangent frame, built from the surface the ground actually has.
        // Three's shading normal is in *view* space and the map's is tangent
        // space, and this surface is not flat, so "up" is not up. The UVs run
        // along world X and Y, so the tangent is world X projected onto the
        // surface and the bitangent follows.
        vec3 gN = normalize(vGroundNormal);
        vec3 gT = normalize(vec3(1.0, 0.0, 0.0) - gN * gN.x);
        vec3 gB = cross(gN, gT);
        vec3 detailN = normalize(vec3(layerNormal.xy * 1.9, layerNormal.z));
        vec3 worldNormal = normalize(gT * detailN.x + gB * detailN.y + gN * detailN.z);
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
        layer.color.dispose();
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
 * <p>Color maps are sRGB and the other two are not, and getting that backwards
 * is the classic way to end up with washed-out ground and normals that bend the
 * wrong way: a normal map is a direction encoded as a color, not a color.
 */
function load(loader: TextureLoader, url: string, isColor: boolean): Texture {
  const texture = loader.load(new URL(url, import.meta.url).href);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  if (isColor) {
    texture.colorSpace = SRGBColorSpace;
  }
  // Sixteen taps rather than the default, because this ground is seen at a
  // glancing angle across its whole depth — which is exactly where an
  // un-anisotropic texture turns to mush a few feet from the camera.
  texture.anisotropy = 16;
  return texture;
}

export type { GroundField };
