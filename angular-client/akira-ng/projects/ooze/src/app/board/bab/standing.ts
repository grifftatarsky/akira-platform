import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { type GroundField, groundAt, heightAt, noise, slopeAt } from '../ground-field';
import { assetUrl } from './assets';
import type { Cut, FoliageSheet } from './foliage-cards';

/**
 * What stands above the sward: trees, scrub and stone.
 *
 * <p><b>A meadow is mostly grass, and the count is the first decision.</b>
 * Surveys of wood pasture put scattered trees at up to thirty-four the hectare
 * before the habitat stops being open ground and starts being woodland. This
 * board is two hundred and twenty feet by a hundred and fifty — three tenths of
 * a hectare — so the whole map supports about ten trees, and rather fewer if it
 * is grazed. Filling it with trees would not be a prettier meadow, it would be
 * a different habitat.
 *
 * <p><b>And they are not scattered at random.</b> Random is the mistake this
 * renderer already made once with the grass, and it reads as a texture rather
 * than as a place. Trees in pasture stand where something let them: along the
 * boundary, along the track where a mower cannot reach, and as the occasional
 * lone specimen nobody got round to felling. Scrub comes in from the margins
 * and from the verge for the same reason — it is where the grazing stops.
 * Stone shows where the soil is thin, which is the rises and the worn ground.
 *
 * <p>So every kind here is placed by a rule against the ground field the board
 * already has — how worn, how damp, how steep, how near the edge — times its
 * own slow noise, and a candidate that fails the rule is simply not planted.
 */

/** A tree is a trunk and a canopy of cards; both are one merged mesh. */
export interface Standing {
  readonly meshes: readonly Mesh[];
  dispose(): void;
}

/**
 * Trees per hectare, at the open end of wood pasture.
 *
 * <p>Twelve on this board, before the rules refuse any of them. The refusals
 * matter more than the number: a candidate on the track, on a steep bank or in
 * the middle of the open field is thrown away, so the survivors are wherever
 * the board happens to have a margin.
 */
const TREES = 7;
const SCRUB = 54;
/**
 * <b>A dozen, not two dozen.</b> Twenty-six was a scree slope. A grazed field
 * with a cart track through it turns out a stone at a time over years, and what
 * you see is a handful along the verge and a couple the plough went round.
 */
const STONES = 11;

/** Half-feet. A hedgerow oak in a Virginia field, give or take. */
const TREE_TALL = 64;

interface Build {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

function empty(): Build {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

/** A stable hash in nought to one, so a board is the same board every load. */
function dice(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * How near the board's own edge a point is, in half-feet, as nought to one
 * across the first twenty.
 *
 * <p>The boundary is where a field's trees are, because the boundary is the one
 * line a plough and a mower both stop at.
 */
function margin(field: GroundField, x: number, y: number): number {
  const near = Math.min(
    x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
  );
  // <b>A band inside the boundary, not a ramp off the edge.</b> A tree wants
  // the field's margin and it wants its whole crown on the board — which is
  // fifty-odd half-feet in, because a crown reaches a third of the tree's
  // height out from the trunk and a lobe adds its own radius. So the band the
  // trees want is the one just inside that line, and it fades toward the middle
  // of the field where only the occasional specimen stands.
  //
  // <p>Written as a ramp off the edge it was worth almost nothing at the only
  // distances a tree is allowed to stand, and the board came out with one tree
  // on it.
  if (near < 52) {
    return 0;
  }
  return 1 - Math.min(1, Math.max(0, near - 58) / 64);
}

/**
 * The lowest the *drawn* ground gets under a footprint, in stage units.
 *
 * <p><b>`heightAt` is not the surface anybody can see.</b> The terrain mesh
 * carries one vertex per half-foot and interpolates between them, so on ground
 * with ruts cut into it — which is most of this board's track — the triangle
 * between two samples runs above the height field in the hollows and below it
 * on the ridges. A trunk placed at the field's own value for its centre point
 * therefore floats by as much as the rut is deep, which is exactly what showed
 * up on the tree standing in the road.
 *
 * <p>Sampling the lattice the mesh actually uses, across the trunk's own
 * footprint, and taking the lowest of them puts the base at or under the
 * drawn surface everywhere it touches. A little buried is invisible; a little
 * airborne is the first thing anyone sees.
 */
function groundUnder(
  field: GroundField, x: number, y: number, reach: number,
): number {
  let low = heightAt(field, x, y);
  const span = Math.max(1, Math.ceil(reach));
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      if (dx * dx + dy * dy > span * span) {
        continue;
      }
      low = Math.min(low, heightAt(
        field, Math.floor(x) + dx, Math.floor(y) + dy,
      ));
    }
  }
  return low;
}

/**
 * Named plants out of one scan, each merged and rebased, ready to scatter.
 *
 * <p>A scan is often several plants captured together, and each plant is
 * several primitives because bark, leaves and twigs are separate materials.
 * The index this takes is a *plant*, and every primitive of that plant comes
 * with it — which is the whole correction this function exists to make.
 */
async function loadPlants(
  name: string, scene: Scene, wanted: readonly number[],
): Promise<Map<number, Mesh>> {
  const box = await LoadAssetContainerAsync(
    assetUrl(`assets/board/models/${name}/${name}.gltf`), scene,
  );
  const drawn = box.meshes.filter(mesh => mesh.getTotalVertices() > 0) as Mesh[];
  // <b>A glTF node is a plant; a primitive is one of that plant's materials.</b>
  // Babylon splits a multi-primitive node into children named
  // `<node>_primitive0..N` under a transform node, so the flat mesh list runs
  // bark, leaves, twigs of the first plant, then of the second, and so on.
  // Indexing that list picks a *material*, not a plant — which is what this
  // file did for two builds: `searsia_lucida` shipped as five copies of one
  // bush's twigs and ten of another's bark. It looked exactly like what it
  // was, a field of disconnected sticks and bare trunks.
  const byNode = new Map<string, Mesh[]>();
  for (const mesh of drawn) {
    const node = mesh.parent && mesh.parent.name !== '__root__' ? mesh.parent : mesh;
    const found = byNode.get(node.name);
    if (found) {
      found.push(mesh);
    } else {
      byNode.set(node.name, [mesh]);
    }
  }
  // Sorted by name, so a plant index means the same plant on every load
  // whatever order the loader happens to resolve its promises in.
  // Sorted inside a plant too, so `_primitive0` — which in both of this
  // board's scans is the bark — is reliably first. The trunk is what the
  // rebase below anchors on.
  const plants = [...byNode.keys()].sort().map(
    key => byNode.get(key)!.sort((a, b) => a.name.localeCompare(b.name)),
  );
  const chosen = [...new Set(wanted)].map(want => ({
    want, parts: plants[Math.min(want, plants.length - 1)] ?? [],
  }));
  const keep = new Set<Mesh>();
  chosen.forEach(({ parts }) => parts.forEach(mesh => keep.add(mesh)));
  drawn.filter(mesh => !keep.has(mesh)).forEach(mesh => mesh.dispose());
  box.removeAllFromScene();

  const out = new Map<number, Mesh>();
  for (const { want, parts } of chosen) {
    if (!parts.length) {
      continue;
    }
    // <b>World transform into the vertices before anything else.</b> A glTF
    // arrives under a `__root__` carrying the handedness flip, and a thin
    // instance's matrix composes against whatever world matrix the mesh
    // already has — so left attached, every instance is placed through that
    // root and lands somewhere else entirely. `setParent(null)` keeps the
    // world transform where clearing `.parent` would drop it, and baking
    // flattens it, flipping the winding with the determinant.
    for (const mesh of parts) {
      mesh.setParent(null);
      mesh.bakeCurrentTransformIntoVertices();
    }
    // <b>The trunk is the anchor, not the bounding box.</b> A plant's overall
    // box bottoms out at whatever hangs lowest, which on a tree is the tip of
    // a drooping branch a foot outside the trunk and well below its base.
    // Rebasing on that stands the tree on its lowest leaf and leaves the trunk
    // hanging in the air — which is exactly what the board showed. The bark
    // primitive's own lowest point is where the plant actually meets soil, and
    // its horizontal centre is the trunk rather than the centre of a lopsided
    // crown, so an instance lands where it was asked to.
    parts[0].refreshBoundingInfo();
    const trunk = parts[0].getBoundingInfo().boundingBox;
    const stands = new Vector3(
      (trunk.minimum.x + trunk.maximum.x) / 2,
      trunk.minimum.y,
      (trunk.minimum.z + trunk.maximum.z) / 2,
    );
    const one = parts.length === 1
      ? parts[0]
      : Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (!one) {
      continue;
    }
    // <b>`MergeMeshes` builds its result in the scene already.</b> Adding it a
    // second time put `island_tree_02` in `scene.meshes` twice, and a mesh
    // listed twice is dispatched twice — every tree on this board was drawn
    // two times, for nothing anybody could see.
    if (!scene.meshes.includes(one)) {
      scene.addMesh(one);
    }
    // <b>Base at nought, centred over its own footprint.</b> A scan's node
    // origin is wherever the capture rig's was, which for a plant lifted out
    // of a seven-plant scan is metres away from the plant. Rebasing here means
    // the placement below can say "at this point on the ground" and be right.
    one.bakeTransformIntoVertices(Matrix.Translation(
      -stands.x, -stands.y, -stands.z,
    ));
    one.refreshBoundingInfo();
    one.position.setAll(0);
    one.rotationQuaternion = null;
    one.rotation.setAll(0);
    one.scaling.setAll(1);
    one.computeWorldMatrix(true);
    out.set(want, one);
  }
  return out;
}

/**
 * Trees and scrub, from scans, scattered by the same rules the cards were.
 *
 * <p><b>These replaced trees I built out of cards, and building them was the
 * mistake.</b> The plants in the sward worked because a scan states a shape
 * exactly and a card only has to carry it; a tree is not one shape, it is a
 * structure, and composing one out of foliage clumps produced something that
 * read as a stack of boxes however the cards were arranged. The lesson the
 * meadow already taught — find the photograph, do not draw it — applies twice
 * as hard to the more complicated object.
 *
 * <p><b>They are big, and that is the trade.</b> Poly Haven's `island_tree_02`
 * is forty-five megabytes and `searsia_lucida` nineteen. Every CC0 tree that is
 * photographic is that size, and every CC0 tree that is small is flat-shaded
 * low-poly that would sit beside photographed grass looking like a different
 * game. This board is not deployed; it downloads once and instances after.
 */
export async function plantScans(
  field: GroundField, scene: Scene,
): Promise<Mesh[]> {
  const kinds: {
    readonly name: string;
    readonly count: number;
    /** Half-feet the scan measures, so it can be fitted to the board's scale. */
    readonly tall: number;
    readonly inside: number;
    readonly wearMax: number;
    /** How strongly it wants the field's margin over its middle. */
    readonly edge: number;
    /** Which *plant* of a multi-plant scan to take, not which primitive. */
    readonly plant?: number;
  }[] = [
    // <b>Near enough the size they were photographed at, which they were not
    // before.</b> These are small plants: `island_tree_02` is 3.4 m tall and
    // the biggest `searsia_lucida` in its seven-plant scan is 2.3 m. Asking for
    // a seventeen-foot field tree out of a four-foot shrub is a twelve-fold
    // blow-up, and a canopy's leaf density falls with the cube of that — which
    // is why the scrub came out pale and see-through with its stems showing.
    // A scan carries its own density and the only way to keep it is to leave
    // its scale alone.
    //
    // <p>So the tree is the tree, at half again its captured height, and the
    // shrub scan is used as shrubs. Plants sorted by name run a (2.3 m, 136k
    // vertices) down to g (0.8 m, 8k); a, c and e give three silhouettes at
    // eight, five and three feet for less than one `island_tree_02`.
    //
    // <p>Counts are still a budget. A photographic tree is eight hundred
    // thousand vertices, and the way to get a field's real number back is
    // impostors, which is in the plan rather than in this file.
    { name: 'island_tree_02', count: 3, tall: 38, inside: 46, wearMax: 0.58, edge: 0.8 },
    { name: 'searsia_lucida', count: 4, tall: 16, inside: 20, wearMax: 0.6, edge: 0.7, plant: 0 },
    { name: 'searsia_lucida', count: 5, tall: 11, inside: 14, wearMax: 0.66, edge: 0.5, plant: 2 },
    { name: 'searsia_lucida', count: 6, tall: 7, inside: 12, wearMax: 0.7, edge: 0.45, plant: 4 },
  ];

  // One load a file, however many plants are wanted out of it. Parsing an
  // eighteen-megabyte buffer three times to take three bushes out of it is
  // three times the wait for the same result.
  const wanted = new Map<string, number[]>();
  for (const kind of kinds) {
    const list = wanted.get(kind.name) ?? [];
    list.push(kind.plant ?? 0);
    wanted.set(kind.name, list);
  }
  const loaded = new Map<string, Map<number, Mesh>>();
  for (const [name, plants] of wanted) {
    loaded.set(name, await loadPlants(name, scene, plants));
  }

  const out: Mesh[] = [];
  // <b>Shared across every kind, because a tree does not care what species the
  // thing it is standing inside of is.</b> Two trees at the same point read as
  // one broken tree, and the rule that placed them had no way to know.
  const standing: { x: number; y: number; reach: number }[] = [];
  for (let kind = 0; kind < kinds.length; kind++) {
    const want = kinds[kind];
    const scan = loaded.get(want.name)?.get(want.plant ?? 0);
    if (!scan) {
      continue;
    }
    scan.name = `scan-${want.name}-${want.plant ?? 0}`;
    // The scan's own height, so a tree can be asked for in half-feet rather
    // than in whatever units it was captured at.
    scan.refreshBoundingInfo();
    const box = scan.getBoundingInfo().boundingBox;
    const own = Math.max(0.001, box.maximum.y - box.minimum.y);

    const matrices: Matrix[] = [];
    // <b>The count is a promise, the rule is a preference.</b> A weighted rule
    // that can refuse every candidate will, and the board comes back with one
    // tree on it — which has happened twice. So the rule gets the first
    // two-thirds of the attempts to itself, and after that only the hard vetoes
    // apply: on the board, off the track, off a bank, and clear of its
    // neighbours.
    const tries = want.count * 60;
    for (let at = 0; at < tries && matrices.length < want.count; at++) {
      const insist = at > tries * 0.66;
      const x = dice(at, 37 + kind * 3, 61 + kind * 7) * field.extentXHalfFeet;
      const y = dice(at, 41 + kind * 5, 67 + kind * 11) * field.extentYHalfFeet;
      const inside = Math.min(
        x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
      );
      const { wear } = groundAt(field, x, y);
      if (inside < want.inside || wear > want.wearMax
        || slopeAt(field, x, y) > 0.44) {
        continue;
      }
      const size = (want.tall / own) * (0.78 + 0.44 * dice(at, 5, 7 + kind));
      // A crown reaches about a third of the tree's height out from the trunk,
      // so two of them touch at two thirds of the taller one's height. Half
      // that is the closest two trees in a pasture stand without one of them
      // having lost the argument.
      const reach = want.tall * (size / (want.tall / own)) * 0.34;
      if (standing.some(other => {
        const dx = other.x - x;
        const dy = other.y - y;
        return dx * dx + dy * dy < (other.reach + reach) * (other.reach + reach);
      })) {
        continue;
      }
      const band = 1 - Math.min(1, Math.max(0, inside - want.inside - 6) / 70);
      const verge = wear > 0.18 && wear < 0.5 ? 1 : 0;
      const drift = noise(
        x * 0.014 + 31.7 + kind * 9, y * 0.014 - 12.3 - kind * 4,
      );
      if (!insist && band * want.edge + verge * 0.45 + drift * 0.55 < 0.66
        && dice(at, 1, 91 + kind) > 0.1) {
        continue;
      }
      standing.push({ x, y, reach });
      matrices.push(Matrix.Compose(
        new Vector3(size, size * (0.9 + 0.22 * dice(at, 9, 13)), size),
        Quaternion.FromEulerAngles(0, dice(at, 13, 89) * 6.2831853, 0),
        // A shade into the ground, so a trunk meets the turf rather than
        // standing on it.
        new Vector3(
          x, groundUnder(field, x, y, reach * 0.4) - want.tall * 0.02, y,
        ),
      ));
    }
    if (!matrices.length) {
      scan.dispose();
      continue;
    }
    const packed = new Float32Array(matrices.length * 16);
    matrices.forEach((matrix, at) => matrix.copyToArray(packed, at * 16));
    scan.thinInstanceSetBuffer('matrix', packed, 16);
    scan.alwaysSelectAsActiveMesh = true;
    scan.receiveShadows = true;
    out.push(scan);
  }
  return out;
}

/**
 * Fieldstone, as real geometry rather than cards.
 *
 * <p><b>The one place a downloaded model is the right answer.</b> Poly Haven's
 * vegetation is enormous — its pine is a 948 MB geometry buffer — but a boulder
 * is two or three megabytes.
 *
 * <p>Scattered as thin instances off one mesh: two dozen rocks is one draw, and
 * a rock has no reason to be its own object until something stands behind it.
 *
 * <p><b>Both kinds are placed in one pass, and that is the point.</b> Placed a
 * kind at a time there is nothing to stop the second kind landing on top of the
 * first, and nothing did: the board shipped with two boulders sitting against
 * each other in the middle of the track, the same size and near enough the same
 * rotation to read as one stone drawn twice.
 */
export async function scatterStone(
  field: GroundField, scene: Scene,
): Promise<Mesh[]> {
  const names = ['namaqualand_boulder_02', 'namaqualand_boulder_04'];
  const rocks: Mesh[] = [];
  for (let kind = 0; kind < names.length; kind++) {
    const name = names[kind];
    const box = await LoadAssetContainerAsync(
      assetUrl(`assets/board/models/${name}/${name}.gltf`), scene,
    );
    const rock = box.meshes.find(mesh => mesh.getTotalVertices() > 0) as Mesh | undefined;
    if (!rock) {
      box.dispose();
      continue;
    }
    box.removeAllFromScene();
    rock.name = `stone-${kind}`;
    scene.addMesh(rock);
    // <b>Off its parent, and its own transform baked in.</b> A glTF arrives
    // under a `__root__` node carrying the handedness flip, and a thin
    // instance's matrix is composed against whatever the mesh's own world
    // matrix already is — so left attached, two dozen boulders were placed
    // through that root's rotation and scale and landed in a line beside the
    // board, floating at nothing.
    rock.setParent(null);
    rock.bakeCurrentTransformIntoVertices();
    rock.position.setAll(0);
    rock.rotationQuaternion = null;
    rock.rotation.setAll(0);
    rock.scaling.setAll(1);
    rock.computeWorldMatrix(true);
    if (rock.material) {
      scene.addMaterial(rock.material);
    }
    rocks.push(rock);
  }
  if (!rocks.length) {
    return [];
  }

  // glTF is Y-up and so is the stage, so nothing to swap — but the scan's own
  // scale is metres and this board counts half-feet.
  const perMetre = 6.56;
  const placed: { x: number; y: number; reach: number }[] = [];
  const perKind: Matrix[][] = rocks.map(() => []);
  // The count is a promise the same way the trees' is: the weighted preference
  // gets most of the attempts, and after that only the hard vetoes apply.
  const tries = STONES * 40;
  for (let at = 0; at < tries && placed.length < STONES; at++) {
    const insist = at > tries * 0.7;
    const x = dice(at, 29, 61) * field.extentXHalfFeet;
    const y = dice(at, 31, 67) * field.extentYHalfFeet;
    const inside = Math.min(
      x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
    );
    if (inside < 10) {
      continue;
    }
    const { wear } = groundAt(field, x, y);
    const steep = slopeAt(field, x, y);
    // <b>Beside the track, not in it.</b> The rule this replaces *preferred*
    // worn ground, which put boulders in the ruts of a road that carts use —
    // and a cart road with a three-foot stone in the middle of it is a road
    // nobody drove down. What a used track actually collects is stone along
    // its verge, turned out by the wheels, which is the band just outside it.
    if (wear > 0.56) {
      continue;
    }
    // <b>Fieldstone, not gravel.</b> The scan is a metre-and-a-bit boulder and
    // a tenth of that is a pebble nobody can see from the board's own camera.
    // Between two and six feet across is a stone you would take cover behind,
    // which is the only reason a combat map has one. Spread wider than it was,
    // because two neighbours of the same size read as a copy-paste.
    const size = perMetre * (0.24 + 0.7 * dice(at, 5, 73));
    const reach = size * 0.75;
    if (placed.some(other => {
      const dx = other.x - x;
      const dy = other.y - y;
      const apart = other.reach + reach + 6;
      return dx * dx + dy * dy < apart * apart;
    })) {
      continue;
    }
    const verge = wear > 0.14 && wear < 0.5 ? 1 : 0;
    // Stone shows where the soil is thin, which on this board is the rises the
    // plough went round.
    const thin = Math.min(1, steep / 0.3);
    const drift = noise(x * 0.02 + 5.1, y * 0.02 - 8.4);
    if (!insist && verge * 0.5 + thin * 0.5 + drift * 0.4 < 0.5) {
      continue;
    }
    const kind = dice(at, 3, 101) < 0.5 ? 0 : rocks.length - 1;
    placed.push({ x, y, reach });
    perKind[kind].push(Matrix.Compose(
      new Vector3(size, size * (0.66 + 0.42 * dice(at, 7, 79)), size),
      Quaternion.FromEulerAngles(
        (dice(at, 11, 83) - 0.5) * 0.4,
        dice(at, 13, 89) * 6.2831853,
        (dice(at, 17, 97) - 0.5) * 0.4,
      ),
      // Sunk a little, so a boulder sits in the ground rather than on it.
      new Vector3(x, groundUnder(field, x, y, reach * 0.5) - size * 0.28, y),
    ));
  }

  const out: Mesh[] = [];
  rocks.forEach((rock, kind) => {
    const matrices = perKind[kind];
    if (!matrices.length) {
      rock.dispose();
      return;
    }
    const packed = new Float32Array(matrices.length * 16);
    matrices.forEach((matrix, at) => matrix.copyToArray(packed, at * 16));
    rock.thinInstanceSetBuffer('matrix', packed, 16);
    rock.receiveShadows = true;
    rock.alwaysSelectAsActiveMesh = true;
    out.push(rock);
  });
  return out;
}

export function raiseStanding(
  field: GroundField, sheet: FoliageSheet, scene: Scene,
): Standing {
  const canopy = sheet.groups['canopy'] ?? [];
  if (!canopy.length) {
    return { meshes: [], dispose: () => undefined };
  }

  const leaves = empty();
  const bark = empty();

  // <b>Trees.</b> A candidate is judged, not placed: it wants a margin or a
  // verge, it will not stand on the track itself, and it will not stand on a
  // bank. What is left is a handful, in the places a handful would be.
  let planted = 0;
  for (let at = 0; at < TREES * 22 && planted < TREES; at++) {
    const x = dice(at, 3, 11) * field.extentXHalfFeet;
    const y = dice(at, 7, 23) * field.extentYHalfFeet;
    const { wear, wet } = groundAt(field, x, y);
    // <b>A veto, not a weight.</b> The margin used to be one term of a sum, so
    // a candidate with a strong drift behind it could still be planted on the
    // board's rim — and a crown two dozen half-feet across then hangs over the
    // edge with nothing under it. There is no weighting that makes that
    // acceptable, so it is a refusal instead.
    // Fifty-two, because a crown reaches a third of the tree's height out from
    // its trunk and a lobe adds its own radius on top of that. Anything less
    // and the leaves hang over the rim of the board.
    const inside = Math.min(
      x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
    );
    if (inside < 52 || wear > 0.58 || slopeAt(field, x, y) > 0.42) {
      continue;
    }
    // Near the boundary, or near the track but off it, or the one in ten that
    // is simply out in the open. A field with trees only round its edge is a
    // paddock; a field with one in the middle of it is a field.
    const edge = margin(field, x, y);
    const verge = wear > 0.18 && wear < 0.5 ? 1 : 0;
    const drift = noise(x * 0.014 + 31.7, y * 0.014 - 12.3);
    const wants = edge * 0.75 + verge * 0.5 + drift * 0.5;
    if (wants < 0.62 && dice(at, 1, 91) > 0.12) {
      continue;
    }
    planted++;
    const tall = TREE_TALL * (0.74 + 0.52 * dice(at, 5, 7));
    const lean = (dice(at, 9, 13) - 0.5) * 0.16;
    addTree(leaves, bark, canopy, x, y, heightAt(field, x, y), tall, lean, at, wet);
  }

  // <b>Scrub.</b> Bramble and thorn come in where the grass is not cut, which
  // is the verge and the boundary. Low, wide and clumped: three or four cards
  // lying almost flat, which is also the only way a bush reads from a camera
  // directly above it.
  for (let at = 0; at < SCRUB * 4; at++) {
    const x = dice(at, 17, 41) * field.extentXHalfFeet;
    const y = dice(at, 19, 53) * field.extentYHalfFeet;
    const { wear } = groundAt(field, x, y);
    const inside = Math.min(
      x, y, field.extentXHalfFeet - x, field.extentYHalfFeet - y,
    );
    if (inside < 10 || wear > 0.62) {
      continue;
    }
    const edge = margin(field, x, y);
    const verge = wear > 0.2 && wear < 0.55 ? 1 : 0;
    const drift = noise(x * 0.03 - 8.1, y * 0.03 + 44.2);
    if (edge * 0.7 + verge * 0.6 + drift * 0.7 < 0.78) {
      continue;
    }
    const wide = 3.4 + 4.2 * dice(at, 23, 3);
    addScrub(leaves, canopy, x, y, heightAt(field, x, y), wide, at);
  }

  const sward = new PBRMaterial('standing-leaf', scene);
  sward.metallic = 0;
  sward.roughness = 0.62;
  sward.backFaceCulling = false;
  sward.twoSidedLighting = false;
  sward.albedoTexture = sheet.texture;
  sward.albedoColor = new Color3(1, 1, 1);
  sward.useAlphaFromAlbedoTexture = true;
  sward.transparencyMode = PBRMaterial.MATERIAL_ALPHATEST;
  sward.alphaCutOff = 0.34;
  // The same trade the meadow makes, for the same measured reason: a PBR
  // material with no reflection of its own falls back to the scene's, and the
  // whole irradiance path for an ambient term at 0.14 is the most expensive
  // thing on a leaf.
  (sward as unknown as { _getReflectionTexture(): null })
    ._getReflectionTexture = () => null;
  sward.subSurface.isTranslucencyEnabled = true;
  sward.subSurface.minimumThickness = 0;
  sward.subSurface.maximumThickness = 0.14;
  sward.subSurface.translucencyIntensity = 0.6;
  sward.subSurface.tintColor = new Color3(0.55, 0.72, 0.28);

  const trunk = new PBRMaterial('standing-bark', scene);
  trunk.metallic = 0;
  trunk.roughness = 1;
  const barkColor = new Texture(
    assetUrl('assets/board/polyhaven/bark_brown_02_diff_1k.jpg'), scene, false, false,
  );
  const barkRelief = new Texture(
    assetUrl('assets/board/polyhaven/bark_brown_02_nor_gl_1k.jpg'), scene, false, false,
  );
  const barkSurface = new Texture(
    assetUrl('assets/board/polyhaven/bark_brown_02_arm_1k.jpg'), scene, false, false,
  );
  trunk.albedoTexture = barkColor;
  trunk.bumpTexture = barkRelief;
  trunk.invertNormalMapY = false;
  trunk.metallicTexture = barkSurface;
  trunk.useAmbientOcclusionFromMetallicTextureRed = true;
  trunk.useRoughnessFromMetallicTextureGreen = true;
  trunk.backFaceCulling = false;

  const meshes: Mesh[] = [];
  const put = (build: Build, name: string, material: PBRMaterial): void => {
    if (!build.indices.length) {
      return;
    }
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = build.positions;
    data.normals = build.normals;
    data.uvs = build.uvs;
    data.indices = build.indices;
    data.applyToMesh(mesh);
    mesh.material = material;
    // <b>They cast, and the meadow does not.</b> A tree is the one thing on
    // this board whose shadow is worth a shadow map: it is large, it is sharp
    // at this cascade resolution, and the dark patch under a tree is most of
    // what says there is a tree there at all when the camera is overhead.
    mesh.receiveShadows = true;
    meshes.push(mesh);
  };
  put(leaves, 'standing-leaves', sward);
  put(bark, 'standing-bark', trunk);

  return {
    meshes,
    dispose(): void {
      meshes.forEach(mesh => mesh.dispose());
      sward.dispose();
      trunk.dispose();
      barkColor.dispose();
      barkRelief.dispose();
      barkSurface.dispose();
    },
  };
}

/**
 * One tree: a trunk, limbs, and a lobe of foliage on the end of each.
 *
 * <p><b>The first version was a ball of cards and it looked like Minecraft.</b>
 * Every guide on drawing foliage says the same thing in the same order — start
 * from the silhouette, and *carve secondary lobes so it is not a balloon* — and
 * a sphere of clusters is precisely the balloon. It also floated: with no
 * branches between the trunk and the crown, the canopy was a separate object
 * hanging above a post.
 *
 * <p>So this follows the structure instead. The trunk forks; five limbs leave
 * the fork at real branching angles and taper as they go; each limb ends in a
 * lobe, and the lobes are different sizes at different heights, which is what
 * gives a crown its lumpy outline. The cards fill the lobes rather than the
 * crown, so the gaps between lobes stay gaps — and the gaps are the whole
 * difference between a tree and a bush on a stick.
 *
 * <p>The limbs are drawn, not implied. They cost ten triangles each and they
 * are what connects the thing.
 */
function addTree(
  leaves: Build, bark: Build, canopy: readonly Cut[],
  x: number, y: number, ground: number, tall: number, lean: number,
  seed: number, wet: number,
): void {
  const forkAt = tall * 0.42;
  const thick = tall * 0.030;
  const top: Vec = [x + lean * forkAt, ground + forkAt, y];
  addLimb(bark, [x, ground, y], top, thick * 1.5, thick * 0.74);

  // <b>Five limbs, at angles a tree actually uses.</b> A broadleaf leaves its
  // fork between twenty-five and fifty degrees off vertical; wider than that is
  // a shrub and narrower is a poplar. They are not evenly spaced either — the
  // golden angle plus a nudge, because four limbs at ninety degrees is a
  // telegraph pole with arms.
  const limbs = 4 + Math.floor(dice(seed, 3, 2) * 3);
  const lobes: { at: Vec; size: number }[] = [];
  for (let n = 0; n < limbs; n++) {
    const around = n * 2.39996 + dice(seed, n, 8) * 0.7;
    const out = 0.42 + 0.36 * dice(seed, n, 14);
    const reach = tall * (0.30 + 0.16 * dice(seed, n, 22));
    const end: Vec = [
      top[0] + Math.cos(around) * out * reach,
      top[1] + reach * (0.82 - out * 0.34),
      top[2] + Math.sin(around) * out * reach,
    ];
    addLimb(bark, top, end, thick * 0.7, thick * 0.28);
    lobes.push({ at: end, size: tall * (0.15 + 0.07 * dice(seed, n, 26)) });
  }
  // And one over the fork, so the crown closes above the trunk instead of
  // leaving a hole straight down it from the board's own camera.
  lobes.push({
    at: [top[0], top[1] + tall * 0.30, top[2]],
    size: tall * 0.17,
  });

  for (let n = 0; n < lobes.length; n++) {
    const lobe = lobes[n];
    const cards = 10 + Math.floor(dice(seed, n, 31) * 6);
    for (let c = 0; c < cards; c++) {
      const around = c * 2.39996 + dice(seed, n * 7 + c, 4) * 0.8;
      const deep = Math.cbrt((c + 0.5) / cards);
      const up = dice(seed, n * 11 + c, 37) * 2 - 1;
      const ring = Math.sqrt(Math.max(0, 1 - up * up));
      addCanopyCard(
        leaves, canopy[(seed * 5 + n * 3 + c) % canopy.length],
        lobe.at[0] + Math.cos(around) * ring * deep * lobe.size,
        lobe.at[2] + Math.sin(around) * ring * deep * lobe.size,
        lobe.at[1] + up * deep * lobe.size * 0.8,
        lobe.size * (0.78 + 0.44 * dice(seed, n * 13 + c, 17)),
        around, Math.max(0.05, up * 0.5 + 0.5),
        dice(seed, n * 17 + c, 41), wet,
      );
    }
  }
}

/** A tapering limb between two points. Five sides is plenty at this size. */
function addLimb(
  build: Build, from: Vec, to: Vec, thickFrom: number, thickTo: number,
): void {
  const up = unit([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  // Any vector not along the limb will do to start the frame off.
  const aside = Math.abs(up[1]) > 0.9 ? [1, 0, 0] as Vec : [0, 1, 0] as Vec;
  const across = unit(cross(up, aside));
  const through = cross(up, across);

  const sides = 5;
  const first = build.positions.length / 3;
  for (const [end, size] of [[from, thickFrom], [to, thickTo]] as const) {
    for (let side = 0; side <= sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const nx = across[0] * ca + through[0] * sa;
      const ny = across[1] * ca + through[1] * sa;
      const nz = across[2] * ca + through[2] * sa;
      build.positions.push(
        end[0] + nx * size, end[1] + ny * size, end[2] + nz * size,
      );
      build.normals.push(nx, ny, nz);
      build.uvs.push(side / sides, end === from ? 0 : 1.6);
    }
  }
  for (let side = 0; side < sides; side++) {
    const a = first + side;
    const b = first + sides + 1 + side;
    build.indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
}

/** Bramble and thorn: the same cards, low and wide and lying over. */
function addScrub(
  leaves: Build, canopy: readonly Cut[],
  x: number, y: number, ground: number, wide: number, seed: number,
): void {
  const cards = 3 + Math.floor(dice(seed, 4, 9) * 3);
  for (let n = 0; n < cards; n++) {
    const around = n * 2.39996 + dice(seed, n, 6) * 0.9;
    const away = wide * 0.32 * Math.sqrt(dice(seed, n, 12));
    addCanopyCard(
      leaves, canopy[(seed + n) % canopy.length],
      x + Math.cos(around) * away, y + Math.sin(around) * away,
      ground + wide * (0.16 + 0.2 * dice(seed, n, 18)),
      wide * (0.5 + 0.3 * dice(seed, n, 21)),
      around, 0.72, dice(seed, n, 33), 0,
    );
  }
}

/**
 * One card of foliage, at a point, facing out along the dome it belongs to.
 *
 * <p>Its silhouette is followed the same way the meadow's is — the two columns
 * of vertices sit on the outline the packer recorded rather than on a bounding
 * box — because alpha testing shades a fragment before it discards it, so the
 * empty corners of a canopy card are paid for at full price.
 */
function addCanopyCard(
  build: Build, cut: Cut,
  x: number, y: number, z: number, size: number,
  around: number, up: number, roll: number, wet: number,
): void {
  const wide = size * cut.aspect;
  const ca = Math.cos(around);
  const sa = Math.sin(around);

  // The card's own frame: `face` points out along the dome, `across` is
  // horizontal and square to it, `along` completes the pair.
  const flat = Math.sqrt(Math.max(0.0001, 1 - up * up));
  const face: Vec = [ca * flat, up, sa * flat];
  const across: Vec = [-sa, 0, ca];
  const along: Vec = cross(face, across);

  // A little roll about the facing axis, so twenty cards on one dome are not
  // twenty copies of the same rectangle.
  const cr = Math.cos(roll * 6.2831853);
  const sr = Math.sin(roll * 6.2831853);
  const u: Vec = add(scale(across, cr), scale(along, sr));
  const v: Vec = add(scale(across, -sr), scale(along, cr));

  const rows = 2;
  const first = build.positions.length / 3;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const edge = spanOf(cut, t);
    // Leaves are paler and yellower where the ground is dry, and the wet end of
    // a field is where a tree is greenest. It is the same fact the sward's own
    // drift reads, said once more on something taller.
    const height = (t - 0.5) * size;
    for (const side of [0, 1] as const) {
      const off = (edge[side] - 0.5) * wide;
      build.positions.push(
        x + u[0] * off + v[0] * height,
        z + u[1] * off + v[1] * height,
        y + u[2] * off + v[2] * height,
      );
      // Normals fan from the dome's own outward direction rather than the
      // card's: a canopy is a rough sphere of leaves and lights like one, and a
      // card lit by its own flat normal reads as a signboard in a tree.
      const lifted = add(face, scale(u, (side === 0 ? -0.5 : 0.5)));
      build.normals.push(...unit(lifted));
      build.uvs.push(
        cut.u0 + (cut.u1 - cut.u0) * edge[side],
        cut.v1 + (cut.v0 - cut.v1) * t,
      );
    }
  }
  for (let row = 0; row < rows; row++) {
    const a = first + row * 2;
    build.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  void wet;
}

type Vec = readonly [number, number, number];

function spanOf(cut: Cut, t: number): readonly [number, number] {
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

function unit(v: Vec): Vec {
  const size = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / size, v[1] / size, v[2] / size];
}
