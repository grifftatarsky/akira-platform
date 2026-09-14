import {
  BoxGeometry, BufferGeometry, CylinderGeometry, Group, Material, Mesh,
  MeshStandardMaterial, Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Buildings, built rather than downloaded.
 *
 * <p>The same argument as the trees. There is no CC0 ruined lighthouse and no
 * CC0 log cabin, and the ones that exist elsewhere are either film assets or
 * somebody else's art style. A tower is a stack of tapering rings and a cabin
 * is a stack of logs; both are a few hundred triangles, both take the board's
 * own materials and light, and both can be *told what to be* — three storeys
 * or five, roofed or open to the sky — which a downloaded mesh cannot.
 *
 * <p>Everything here is built in half-feet, Z up, standing on the origin, so a
 * caller only has to move it to where the ground is.
 */

/** How many sides a round thing has. Sixteen reads as round and costs little. */
const ROUND = 16;

/**
 * A lighthouse with its top broken off.
 *
 * <p><b>The ruin is the whole design.</b> A whole tower is a cylinder and reads
 * as one; what makes a ruin is the *silhouette being wrong* — a wall that goes
 * up further on one side than the other, a gallery with half its floor, and a
 * lantern room that is a ring of stumps where the frame was. So the top course
 * is cut away over an arc rather than shortened, and the arc is off-centre, so
 * the tower has a side it fell from.
 *
 * @param height how tall it stands to the break, in half-feet
 */
export function ruinedLight(height: number): Object3D {
  const stone = new MeshStandardMaterial({ color: 0xa8a49b, roughness: 0.92, metalness: 0 });
  const dark = new MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.95, metalness: 0 });
  const group = new Group();

  const base = height * 0.22;
  const shaft = height * 0.62;
  const foot = 7.5;
  const neck = 4.6;

  // A splayed plinth, because a tower that meets the rock at the same width it
  // has at the top looks like a pipe somebody dropped.
  group.add(ring(stone, foot * 1.5, foot * 1.18, base, 0, ROUND));
  group.add(ring(stone, foot * 1.18, neck * 1.16, shaft, base, ROUND));

  // The broken course: a ring of blocks of falling height, so the wall steps
  // down into the gap instead of ending in a clean cut.
  const brokeAt = 2.1;
  for (let i = 0; i < ROUND; i++) {
    const angle = (i / ROUND) * Math.PI * 2;
    // Distance round the ring from the point it fell from, 0 to 1.
    const round = Math.abs(((angle - brokeAt + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      / Math.PI;
    const stub = height * 0.06 + Math.pow(round, 1.6) * height * 0.2;
    const block = new Mesh(new BoxGeometry(neck * 0.46, 1.5, stub), i % 3 === 0 ? dark : stone);
    block.position.set(
      Math.cos(angle) * neck * 1.06,
      Math.sin(angle) * neck * 1.06,
      base + shaft + stub / 2,
    );
    block.rotation.z = angle;
    group.add(block);
  }

  // What is left of the gallery: a floor ring, and three of its corbels.
  const gallery = ring(dark, neck * 1.9, neck * 1.9, 0.9, base + shaft - 1.2, ROUND);
  group.add(gallery);
  for (let i = 0; i < ROUND; i += 5) {
    const angle = (i / ROUND) * Math.PI * 2;
    const corbel = new Mesh(new BoxGeometry(1.1, 1.1, 3.4), dark);
    corbel.position.set(
      Math.cos(angle) * neck * 1.5,
      Math.sin(angle) * neck * 1.5,
      base + shaft - 3,
    );
    group.add(corbel);
  }

  // A door, sunk into the plinth. One box, and it is the thing that tells you
  // how big the tower is.
  const door = new Mesh(new BoxGeometry(1.2, 3.6, 6.4), dark);
  door.position.set(-foot * 1.32, 0, base * 0.5 + 2.6);
  group.add(door);

  shadowed(group);
  return group;
}

/**
 * Fallen masonry, for the ground around a ruin.
 *
 * <p>Because a tower that broke has to have put its top *somewhere*, and a
 * clean apron of turf under a ruin is the one detail that gives away that it
 * was placed rather than fell.
 */
export function rubbleHeap(seed: number, spread: number): Object3D {
  const stone = new MeshStandardMaterial({ color: 0x97928a, roughness: 0.95, metalness: 0 });
  const parts: BufferGeometry[] = [];
  let n = seed;
  const next = () => {
    n = (n * 1664525 + 1013904223) >>> 0;
    return n / 4294967296;
  };
  for (let i = 0; i < 14; i++) {
    const block = new BoxGeometry(
      1.4 + next() * 2.6, 1.2 + next() * 2.2, 0.9 + next() * 1.8);
    const angle = next() * Math.PI * 2;
    const away = Math.pow(next(), 0.6) * spread;
    block.rotateZ(next() * Math.PI);
    block.rotateX((next() - 0.5) * 0.7);
    block.translate(Math.cos(angle) * away, Math.sin(angle) * away, next() * 0.8);
    parts.push(block);
  }
  const mesh = new Mesh(mergeGeometries(parts) ?? parts[0], stone);
  parts.forEach(p => p.dispose());
  shadowed(mesh);
  return mesh;
}

/**
 * A log cabin: four walls of stacked logs, a gabled roof and a stone chimney.
 *
 * <p>Logs rather than boxes, and that is most of the work. Four flat walls with
 * a roof on top is a shed from any angle; what says *cabin* is the horizontal
 * banding of the courses and the ends crossing at the corners, and both are
 * cheap — a course is a cylinder, and the crossing is the cylinder being longer
 * than the wall.
 */
export function logCabin(across: number, along: number, walls: number): Object3D {
  const log = new MeshStandardMaterial({ color: 0x7d6144, roughness: 0.88, metalness: 0 });
  const shingle = new MeshStandardMaterial({ color: 0x4a423a, roughness: 0.95, metalness: 0 });
  const stone = new MeshStandardMaterial({ color: 0x8b857c, roughness: 0.95, metalness: 0 });
  const group = new Group();

  const thick = 1.5;
  const over = 1.6;
  for (let course = 0; course < walls; course++) {
    const z = thick / 2 + course * thick * 0.92;
    // Alternating courses cross at the corners, which is how the corner is
    // actually made and is the detail that reads from furthest away.
    const longer = course % 2 === 0;
    for (const side of [-1, 1]) {
      const run = new Mesh(
        new CylinderGeometry(thick / 2, thick / 2, longer ? across + over * 2 : across, 7), log);
      run.rotation.z = Math.PI / 2;
      run.position.set(0, (side * along) / 2, z);
      group.add(run);

      const end = new Mesh(
        new CylinderGeometry(thick / 2, thick / 2, longer ? along : along + over * 2, 7), log);
      end.position.set((side * across) / 2, 0, z);
      group.add(end);
    }
  }

  // The gable ends, as a shrinking stack, and the roof planes over them.
  const eaves = thick / 2 + walls * thick * 0.92;
  const peak = eaves + along * 0.32;
  const gables = 6;
  for (let i = 0; i < gables; i++) {
    const t = (i + 0.5) / gables;
    const span = across * (1 - t);
    for (const side of [-1, 1]) {
      const run = new Mesh(new CylinderGeometry(thick / 2, thick / 2, span, 7), log);
      run.rotation.z = Math.PI / 2;
      run.position.set(0, side * (along / 2) * (1 - t) * 0.15, eaves + t * (peak - eaves));
      group.add(run);
    }
  }
  for (const side of [-1, 1]) {
    const slope = Math.hypot(along / 2 + over, peak - eaves);
    const plane = new Mesh(new BoxGeometry(across + over * 2, slope, 0.7), shingle);
    plane.rotation.x = side * Math.atan2(peak - eaves, along / 2 + over);
    plane.position.set(
      0,
      (side * (along / 2 + over)) / 2,
      (eaves + peak) / 2,
    );
    group.add(plane);
  }

  // The chimney, off one gable end. A cabin without one is a shed.
  const stack = new Mesh(new BoxGeometry(3.4, 3.4, peak + 5), stone);
  stack.position.set(across / 2 + 1.2, along * 0.22, (peak + 5) / 2);
  group.add(stack);

  // A door and a shuttered window, both simply darker than the wall, because
  // at this camera an opening is a dark rectangle and nothing more.
  const dark = new MeshStandardMaterial({ color: 0x241d16, roughness: 1, metalness: 0 });
  const door = new Mesh(new BoxGeometry(4.4, 0.6, 7.4), dark);
  door.position.set(-across * 0.1, -along / 2 - 0.2, 3.9);
  group.add(door);
  const window = new Mesh(new BoxGeometry(3.2, 0.6, 3), dark);
  window.position.set(across * 0.26, -along / 2 - 0.2, 8.6);
  group.add(window);

  shadowed(group);
  return group;
}

/** A tapering ring of wall, as one cylinder. */
function ring(
  material: Material, bottom: number, top: number, tall: number, at: number, sides: number,
): Mesh {
  const geometry = new CylinderGeometry(top, bottom, tall, sides, 1, true);
  // Cylinders are built about Y and this world is Z up.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, at + tall / 2);
  const mesh = new Mesh(geometry, material);
  return mesh;
}

function shadowed(node: Object3D): void {
  node.traverse(child => {
    child.castShadow = true;
    child.receiveShadow = true;
  });
}
