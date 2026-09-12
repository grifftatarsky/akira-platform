import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import { assetUrl } from './assets';
import type { CardSpec, Plant } from './species';

/**
 * Plants built from photographed cut-outs on cards, rather than modelled.
 *
 * <p><b>Why this replaced the generator.</b> Measured by taking each species
 * away, the meadow cost 17.7 ms of a 26 ms frame, and 16.8 of that was four
 * species that are not grass — flat at 0.68 ms per million triangles, so the
 * bill is triangles and nothing else. A clover was seventy-six of them: three
 * leaflets, each three columns of vertices wide, with a crease down the middle
 * and a notch at the tip. All of that to describe a shape that a scan of a real
 * clover states exactly, on two triangles.
 *
 * <p>It is also the better-looking half of the trade, which is the part worth
 * being honest about. A generated leaf has the shape someone wrote down; a
 * scanned one has the shape it grew, with the blotch on one leaflet and the
 * chewed edge on another. No amount of parameters reaches that.
 *
 * <p><b>What a card cannot do is be seen edge-on.</b> A flat quad viewed along
 * its plane is a line, which is most of what "negative space" means in a field
 * of them. Two things answer it: the plant is built from more than one card at
 * different angles, and the wind plugin turns each card about its own stem
 * toward the camera — Ghost of Tsushima's view-space thickening, said
 * geometrically.
 *
 * <p>Sources are all CC0 and vendored under `public/assets/board/foliage`, with
 * the packer in `tools/foliage-pack.mjs` and the provenance in ASSETS.md.
 */

/** One cut-out's place on the sheet, and the proportions it was scanned at. */
export interface Cut {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  /** Width over height of the original scan, so a card is never stretched. */
  readonly aspect: number;
  /**
   * Where the silhouette starts and stops at each of thirteen heights, root
   * first, as fractions of the cut-out's own width.
   *
   * <p><b>This is what stops a card being a bounding box.</b> Alpha testing
   * disables early-Z, so every fragment inside a card's quad is shaded and only
   * then thrown away by the cutout — and a scanned grass spray fills a fifth of
   * its box, so four fifths of its fragments are pure waste. Measured, that
   * waste is the entire remaining cost of this meadow.
   *
   * <p>The card is already rows of two vertices. Moving those two to where the
   * leaf actually begins and ends at that height fits the strip to the plant for
   * no extra vertices at all.
   */
  readonly spans: readonly (readonly [number, number])[];
}

export interface FoliageSheet {
  readonly texture: Texture;
  readonly groups: Readonly<Record<string, readonly Cut[]>>;
}

/**
 * Loads the sheet and its cut-out table.
 *
 * <p><b>Through `assetUrl`, and counting the directories by hand is the trap.</b>
 * This resolved its own base with four `..` segments and it worked in the built
 * bundle by accident — the chunk sits at the remote's root there, so climbing
 * past it clamps and lands on the right path anyway. Under the dev server the
 * module is served from its source path, four levels up is somewhere in the
 * workspace, and the miss comes back as index.html at 200 with a content type of
 * text/html. `JSON.parse` then reports an unexpected `<`, which is the board
 * saying it has been handed a web page and not one word about which file.
 */
export async function loadFoliage(scene: Scene): Promise<FoliageSheet> {
  const table = await (await fetch(assetUrl('assets/board/foliage/foliage.json'))).json() as {
    groups: Record<string, Cut[]>;
  };
  // <b>`invertY` is a constructor argument and cannot be set afterwards.</b>
  // The cut-out table is in image coordinates — v grows downward, the way the
  // file is laid out — so the sampler has to agree rather than flipping, and
  // the flag has to be passed in at load or the sheet reads upside down.
  const texture = new Texture(
    assetUrl('assets/board/foliage/foliage.png'), scene, false, false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  // A card is a long thin sliver seen at a glancing angle most of the time, and
  // that is exactly where trilinear alone over-blurs into mush.
  texture.anisotropicFilteringLevel = 8;
  texture.hasAlpha = true;
  return { texture, groups: table.groups };
}

interface Build {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/**
 * How hard a card's normal is tilted toward the sky.
 *
 * <p>A leaf is thin and scatters from both faces, so erring skyward errs the
 * way the real thing does — and a normal that dips under the horizon takes the
 * hemispheric light's brown, which reads as a black scrap on the ground.
 */
const LEAF_LIFT = 0.22;

/** How far the two edges of a card fan apart, in the card's own plane. */
const EDGE_FAN = 0.3;

/** One plant, at true size in half-feet, rooted at the origin. */
export function cardGeometry(plant: Plant, sheet: FoliageSheet): VertexData {
  const build: Build = { positions: [], normals: [], uvs: [], indices: [] };
  let placed = 0;

  for (const spec of plant.cards) {
    const cuts = sheet.groups[spec.group];
    if (!cuts?.length) {
      continue;
    }
    for (let n = 0; n < spec.count; n++) {
      // Evenly spaced and evenly leaned is a plus sign, and four of those in a
      // field is a pattern the eye picks out at once. The jitter is a fixed
      // function of the index rather than a random number, so the mesh is the
      // same every build — it is geometry, not a simulation.
      const around = spec.count === 1
        ? Math.sin(placed * 7.3) * 0.9
        : (n / spec.count) * Math.PI * 2 + Math.sin(n * 12.9898 + placed) * 0.4;
      const cut = cuts[(n + placed * 3) % cuts.length];
      addCard(build, plant, spec, cut, around, n);
      if (spec.cross !== undefined) {
        // The same head again, turned a right angle and stood partway up. The
        // pair costs two triangles and is the difference between a flower and
        // a white hyphen at every angle but one.
        // A different cut of the same group, so the pair reads as one head
        // with depth rather than as two flowers stuck together.
        addCard(
          build, plant, { ...spec, flat: false, lean: spec.cross },
          cuts[(n + placed * 3 + 1) % cuts.length], around + Math.PI / 2, n + 1,
        );
      }
      placed++;
    }
  }

  if (plant.stemTall > 0.02) {
    addStem(build, plant, sheet);
  }

  const data = new VertexData();
  data.positions = build.positions;
  data.normals = build.normals;
  data.uvs = build.uvs;
  data.indices = build.indices;
  return data;
}

/**
 * One quad, subdivided along its length, standing on the plant's axis.
 *
 * <p>Two columns and no more. A third column down the middle is what the
 * modelled leaves had, for a crease — and a scan already has the crease in its
 * shading, so the column would double the triangles to describe something the
 * texture states. The rows are worth having, because the wind and the plant's
 * own droop bend the card along its length and a bend needs somewhere to
 * happen.
 */
function addCard(
  build: Build, plant: Plant, spec: CardSpec, cut: Cut,
  around: number, index: number,
): void {
  const wide = spec.tall * cut.aspect;
  // A little variety in size, fixed per card index rather than random.
  const vary = 1 + Math.sin(index * 5.17 + spec.tall) * 0.12;
  const tall = spec.tall * vary;

  const ca = Math.cos(around);
  const sa = Math.sin(around);
  // The card's own axes in the plant's frame: across its width, up its length,
  // and the face it presents. A flat card lies in the horizontal plane, which
  // is what a daisy's head does and what a camera above the board wants to see.
  const lean = spec.flat ? Math.PI / 2 : spec.lean;
  const cl = Math.cos(lean);
  const sl = Math.sin(lean);
  const across: Vec = [ca, 0, -sa];
  const up: Vec = [sa * sl, cl, ca * sl];
  const face: Vec = cross(across, up);

  const rows = Math.max(1, spec.rows);
  // <b>The photographed stalk, cut off.</b> A scan of a clover is a trefoil
  // *on its own petiole*, and a card carrying the whole of it has the leaf's
  // stalk baked into the same flat quad — so the leaf can only ever sit at
  // whatever angle its stalk is at. Leaning the card was a rotation standing
  // in for a mesh. Trimming the stalk off the bottom of the cut leaves the
  // leaf free to lie flat on a petiole the mesh draws under it.
  const base = spec.trimStalk ? stalkTop(cut) : 0;
  // <b>A head straddles its stem; a leaf grows out of one.</b> Rooted at `at`
  // and grown upward, two crossed cards at different leans put their middles
  // in different places and read as two flowers side by side — which is what
  // the daisy looked like. Shifting the card back along its own axis puts the
  // picture's middle on the stem instead of its bottom edge.
  const sink = tall * (spec.centred ?? 0);
  const root: Vec = [
    sa * spec.out - up[0] * sink,
    spec.at - up[1] * sink,
    ca * spec.out - up[2] * sink,
  ];
  const first = build.positions.length / 3;

  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const along = tall * t;
    // Where this row sits in the *cut*, which is no longer where it sits on
    // the card once the stalk has been trimmed off the bottom.
    const s = base + (1 - base) * t;
    const step = ((1 - base) * 0.5) / rows;
    // Half a row either side, so consecutive quads between them cover the
    // whole outline with nothing falling down the gap.
    const edge = spanOver(cut, s - step, s + step);
    for (const side of [0, 1] as const) {
      // The silhouette's own edge at this height, as an offset from the middle
      // of the cut-out — so the quad narrows where the plant does.
      const off = (edge[side] - 0.5) * wide * vary;
      build.positions.push(
        root[0] + up[0] * along + across[0] * off,
        root[1] + up[1] * along + across[1] * off,
        root[2] + up[2] * along + across[2] * off,
      );
      // <b>The two edges fan apart.</b> A card with one normal across it is a
      // flat surface and lights like one — every plant in a clump catching the
      // sun at exactly the same moment. Splaying the edge normals away from the
      // face gives a card the reading of something slightly cupped, for no
      // vertices at all.
      const fanned = add(face, scale(across, EDGE_FAN * (side === 0 ? -1 : 1)));
      build.normals.push(...lift(fanned));
      build.uvs.push(
        cut.u0 + (cut.u1 - cut.u0) * edge[side],
        cut.v1 + (cut.v0 - cut.v1) * s,
      );
    }
  }
  for (let row = 0; row < rows; row++) {
    const a = first + row * 2;
    build.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

/**
 * The bare stalk under a flower or a seed head.
 *
 * <p>Two crossed slivers, and they take their colour from the middle of a
 * blade cut-out rather than from anywhere of their own — a stem is green and
 * roughly uniform, and the alternative is a patch of solid colour on the sheet
 * that exists for four triangles.
 */
function addStem(build: Build, plant: Plant, sheet: FoliageSheet): void {
  const blade = sheet.groups['blade']?.[0];
  if (!blade) {
    return;
  }
  const u = (blade.u0 + blade.u1) / 2;
  const v0 = blade.v1 - (blade.v1 - blade.v0) * 0.1;
  const v1 = blade.v1 - (blade.v1 - blade.v0) * 0.9;
  const thick = Math.max(0.014, plant.tall * 0.016);
  const top = plant.stemTall;

  for (const turn of [0, Math.PI / 2]) {
    const cx = Math.cos(turn) * thick;
    const cz = Math.sin(turn) * thick;
    const first = build.positions.length / 3;
    for (const height of [0, top]) {
      for (const side of [-1, 1] as const) {
        build.positions.push(cx * side, height, cz * side);
        build.normals.push(...lift([-cz, 0, cx] as Vec));
        build.uvs.push(u, height === 0 ? v0 : v1);
      }
    }
    build.indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
  }
}

/**
 * The silhouette's left and right edge at a height up the card.
 *
 * <p>Read between the recorded heights rather than snapped to one, so a card
 * subdivided into three rows and a card subdivided into eight both follow the
 * same outline instead of two different staircases of it.
 */
/**
 * The widest the silhouette gets anywhere in the band a row has to cover.
 *
 * <p><b>A quad fitted to point samples clips the picture it is carrying.</b>
 * The cut-out's shape comes from its alpha, not from this geometry — all the
 * geometry has to do is *contain* it. Sampling the outline at each row does the
 * opposite: with two rows, a card takes the silhouette's width at t=0 and t=1
 * and joins them with a straight line, so anything that bulges in between is
 * cut off before the alpha test ever sees it.
 *
 * <p>That is how the oxeye daisy rendered as a white cigarette. Its head is a
 * disc, so its outline is narrow at the bottom, widest in the middle and narrow
 * again at the top; taking only the two ends produced a quad 45 per cent of the
 * flower's width, and the petals were clipped away by the mesh. The clover
 * escaped it only because its own outline happens to reach the edges at both
 * ends.
 *
 * <p>Taking the extremes over each row's band instead means the quad always
 * covers the cut-out whatever the row count, so `rows` goes back to meaning
 * what it should: how much the card can bend, not what shape it is.
 */
/**
 * Where the photographed stalk ends and the leaf begins, as a fraction of the
 * cut's length.
 *
 * <p>Read from the silhouette rather than authored, because it differs from one
 * cut to the next — of the three clover scans one has a long petiole, one a
 * short one and one almost none. A stalk is the run of rows at the bottom
 * narrower than a third of the cut's width; the first row wider than that is
 * the leaf.
 */
function stalkTop(cut: Cut): number {
  const spans = cut.spans;
  if (!spans?.length) {
    return 0;
  }
  for (let at = 0; at < spans.length; at++) {
    if (spans[at][1] - spans[at][0] >= 0.3) {
      // Back off one sample, so the leaf's own join to the stalk survives.
      return Math.max(0, at - 1) / (spans.length - 1);
    }
  }
  return 0;
}

function spanOver(cut: Cut, from: number, to: number): readonly [number, number] {
  const spans = cut.spans;
  if (!spans?.length) {
    return [0, 1];
  }
  const last = spans.length - 1;
  const lo = Math.max(0, Math.min(last, from * last));
  const hi = Math.max(0, Math.min(last, to * last));
  let left = 1;
  let right = 0;
  // The interpolated ends, plus every sample strictly between them — the widest
  // point of a band is at one of those and nowhere else.
  for (const t of [lo, hi]) {
    const edge = spanAt(cut, t / last);
    left = Math.min(left, edge[0]);
    right = Math.max(right, edge[1]);
  }
  for (let at = Math.ceil(lo); at <= Math.floor(hi); at++) {
    left = Math.min(left, spans[at][0]);
    right = Math.max(right, spans[at][1]);
  }
  return left < right ? [left, right] : [0, 1];
}

function spanAt(cut: Cut, t: number): readonly [number, number] {
  const spans = cut.spans;
  if (!spans?.length) {
    return [0, 1];
  }
  const at = Math.min(spans.length - 1, Math.max(0, t * (spans.length - 1)));
  const low = Math.floor(at);
  const high = Math.min(spans.length - 1, low + 1);
  const mix = at - low;
  return [
    spans[low][0] + (spans[high][0] - spans[low][0]) * mix,
    spans[low][1] + (spans[high][1] - spans[low][1]) * mix,
  ];
}

type Vec = readonly [number, number, number];

function cross(a: Vec, b: Vec): Vec {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function add(a: Vec, b: Vec): Vec {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec, by: number): Vec {
  return [a[0] * by, a[1] * by, a[2] * by];
}

/** Normalised, with a bias toward the sky and a floor under it. */
function lift(v: Vec): Vec {
  const flat = Math.hypot(v[0], v[1], v[2]) || 1;
  const x = (v[0] / flat) * (1 - LEAF_LIFT);
  const y = (v[1] / flat) * (1 - LEAF_LIFT) + LEAF_LIFT;
  const z = (v[2] / flat) * (1 - LEAF_LIFT);
  const long = Math.hypot(x, y, z) || 1;
  return [x / long, Math.max(y / long, 0.02), z / long];
}
