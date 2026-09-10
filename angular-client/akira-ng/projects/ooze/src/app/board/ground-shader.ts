/**
 * The ground's fragment shading, as GLSL.
 *
 * <p>Kept apart from the wiring because it is the part worth reading. Every
 * technique in here exists to answer one complaint — that a photographed
 * surface, tiled, reads as tiling — and each attacks a different half of it.
 *
 * <p><b>Stochastic tiling kills the lattice. It does not kill the content.</b>
 * That distinction is the whole design. Shuffling *where* each fragment reads
 * from removes the regular grid, and leaves the fact that every pixel of grass
 * came from one photograph: find a distinctive clump of clover in that image
 * and you will find it again, and again, across the field. So the sampling is
 * stochastic *and* the source is six different photographs, chosen per cell
 * along with the offset and the rotation, from the same hash — three kinds of
 * variety for the price of the one we were already paying.
 */

/** Hashes, the triangle grid, and one layer sampled stochastically. */
export const GROUND_SAMPLING = `
  vec2 groundHash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  float groundHash1(vec2 p) {
    return fract(sin(dot(p, vec2(419.2, 371.9))) * 29411.71);
  }

  // The triangle a point lands in, as three corners and their weights. One
  // triangle to roughly one tile: at the reference's three-per-tile the grid
  // itself becomes the pattern.
  void groundGrid(vec2 uv, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3) {
    vec2 skewed = mat2(1.0, 0.0, -0.57735027, 1.15470054) * uv;
    vec2 base = floor(skewed);
    vec3 t = vec3(fract(skewed), 0.0);
    t.z = 1.0 - t.x - t.y;
    if (t.z > 0.0) {
      w = vec3(t.z, t.y, t.x);
      v1 = base; v2 = base + vec2(0.0, 1.0); v3 = base + vec2(1.0, 0.0);
    } else {
      w = vec3(-t.z, 1.0 - t.y, 1.0 - t.x);
      v1 = base + vec2(1.0, 1.0); v2 = base + vec2(1.0, 0.0); v3 = base + vec2(0.0, 1.0);
    }
  }

  // Each cell gets its own offset *and* its own turn. Rotation is what kills
  // the last of it: offsets alone leave every blade of grass on the board
  // pointing the same way, which the eye reads as one image even when it can
  // no longer find the seams.
  mat2 groundTurn(vec2 cell) {
    float a = groundHash1(cell + 17.3) * 6.2831853;
    return mat2(cos(a), -sin(a), sin(a), cos(a));
  }

  // Sharpened, so one sample dominates almost everywhere and blending is
  // confined to a narrow band along each edge. A flat average of three offset
  // samples regresses toward the texture's mean and turns grass to porridge.
  vec3 groundSharpen(vec3 w) {
    vec3 s = w * w * w;
    return s / max(s.x + s.y + s.z, 0.0001);
  }
`;

/**
 * Sampling an array of variants, with rotation.
 *
 * <p>Rotation changes the derivatives per cell, so the mip level has to be
 * passed explicitly — left to the hardware, each cell's rotated gradients would
 * be computed across a quad that may straddle two cells, and every triangle
 * edge would blur. `textureGrad` is available because three compiles to GLSL ES
 * 3.00 on WebGL2, which is the only thing it targets.
 */
export const GROUND_VARIANTS = `
  vec4 grassVariant(sampler2DArray tex, vec2 uv, vec2 cell, float layers,
                    vec2 dx, vec2 dy) {
    mat2 turn = groundTurn(cell);
    vec2 turned = turn * uv + groundHash(cell);
    // Which photograph this cell is made of. Six of them, so the same clump of
    // clover does not appear twice in a row.
    float layer = floor(groundHash1(cell + 91.7) * layers);
    return textureGrad(tex, vec3(turned, layer), turn * dx, turn * dy);
  }

  vec4 groundVariant(sampler2D tex, vec2 uv, vec2 cell, vec2 dx, vec2 dy) {
    mat2 turn = groundTurn(cell);
    vec2 turned = turn * uv + groundHash(cell);
    return textureGrad(tex, turned, turn * dx, turn * dy);
  }
`;

/**
 * Blending layers by height rather than by cross-fade.
 *
 * <p>A linear fade between grass and dirt dissolves one into the other, which
 * nothing in the world does. Blending by the layers' own relief instead lets
 * whichever surface is *higher* at a point win it, so blades of grass stand
 * proud into the bare ground at the verge and dirt shows between them. The
 * transition interlocks rather than ghosting, and it is the difference between
 * an edge that looks painted and one that looks worn.
 */
export const GROUND_HEIGHT_BLEND = `
  vec3 heightBlend(vec3 w, vec3 h) {
    // A wide-ish band, or the interlocking turns into a hard mosaic.
    const float band = 0.22;
    vec3 raised = w + h * w;
    float top = max(max(raised.x, raised.y), raised.z) - band;
    vec3 kept = max(raised - top, 0.0);
    return kept / max(kept.x + kept.y + kept.z, 0.0001);
  }
`;

/**
 * Shifting color across the board.
 *
 * <p>The cheapest variety there is, and the one that survives being seen from
 * any distance: real ground is not one color. It is drier on the rises and
 * ranker in the hollows, browner where the sun sits on it all afternoon, and
 * greener where the ground holds water. Rotating hue slightly and moving
 * saturation and brightness with a slow noise gets most of that from a texture
 * that has none of it.
 */
export const GROUND_TINT = `
  vec3 shiftColor(vec3 rgb, float hue, float sat, float value) {
    // Rodrigues' rotation about the grey axis: a hue shift without the round
    // trip through HSV, which costs three branches and is worth avoiding in a
    // fragment shader.
    const vec3 grey = vec3(0.57735);
    float c = cos(hue);
    vec3 turned = rgb * c
      + cross(grey, rgb) * sin(hue)
      + grey * dot(grey, rgb) * (1.0 - c);
    float luma = dot(turned, vec3(0.2126, 0.7152, 0.0722));
    return max(mix(vec3(luma), turned, sat) * value, 0.0);
  }
`;
