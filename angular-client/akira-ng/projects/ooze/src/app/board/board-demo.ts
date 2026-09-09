import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { BattleBoard } from './battle-board';
import { KAYKIT_THEME, THEMES } from './board-assets';
import {
  Battle, Combatant, Encounter, MapCell, MapProp, Participant, PropKind,
} from './board.models';

/**
 * A board with nothing behind it.
 *
 * <p>Exists so the renderer can be looked at without a database, a Keycloak or
 * a signed-in DM. Everything else on this route needs all three, and "run four
 * services to see whether the walls line up" is a bad enough loop that the walls
 * stay unchecked.
 *
 * <p><b>Six rooms rather than one, and furnished.</b> A bare rectangle proves
 * the renderer draws; it does not show whether a doorway lines up with the wall
 * it is cut into, whether a staircase actually reaches the ledge it serves,
 * whether a dark room stays dark once art loads over it, or whether a hundred
 * models on screen still run. Every one of those is a real failure this fixture
 * has caught, so the fixture is deliberately a whole dungeon level:
 *
 * <ul>
 *   <li>a torchlit barracks and hall, a dim storeroom, an unlit crypt and a
 *       flooded undercroft — three light levels, drawn over the art;
 *   <li>six terrains: floor, rubble, water, deep water, mud, web and a chasm;
 *   <li>a sanctum that steps up twice, with a staircase onto each level;
 *   <li>creatures from Tiny to Gargantuan, one of them flying over the fissure;
 *   <li>and about a hundred props, which is where the frame budget goes.
 * </ul>
 */
@Component({
  selector: 'ooze-board-demo',
  standalone: true,
  imports: [BattleBoard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-[calc(100vh-8rem)] w-full flex-col gap-2 p-2">
      <div class="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span class="font-semibold text-fg">Board preview</span>
        <span class="text-fg-subtle">— {{ encounter.name }}, no server, no sign-in</span>
        <span class="ml-auto flex items-center gap-1">
          @for (t of themes; track t.id) {
            <button type="button" (click)="theme.set(t)"
                    [attr.aria-pressed]="theme().id === t.id"
                    [class.text-fg]="theme().id === t.id"
                    [class.border-accent]="theme().id === t.id"
                    class="rounded-md border border-rule px-2 py-1 transition hover:text-fg">
              {{ t.name }}
            </button>
          }
        </span>
      </div>

      <div class="min-h-0 flex-1">
        <ooze-battle-board
          [encounter]="encounter"
          [battle]="battle()"
          [theme]="theme()"
          (moved)="onMoved($event)"
          (selected)="selected.set($event)" />
      </div>

      @if (theme().attribution; as credit) {
        <p class="text-[0.65rem] text-fg-subtle">{{ credit }}</p>
      } @else {
        <p class="text-[0.65rem] text-fg-subtle">
          No art loaded — the board falls back to coloured tiles and the furniture
          goes with it, which is what removing a pack looks like. The rooms, the
          light and the terrain are all still there, because those are rules.
        </p>
      }
    </div>
  `,
})
export class BoardDemo {

  protected readonly themes = THEMES;
  protected readonly theme = signal(KAYKIT_THEME);

  protected readonly encounter: Encounter = {
    id: 'demo',
    name: 'The undercroft of Elsmere Keep',
    map: {
      id: 'demo-map',
      width: WIDTH,
      height: HEIGHT,
      cellFeet: 5,
      defaultTerrain: 'FLOOR',
      // Dim by default and lit where somebody put a torch, rather than the
      // other way round. A dungeon is dark; light is the exception and should
      // have to be placed.
      defaultLight: 'DIM',
      cells: buildLevel(),
      // On the map, exactly where the server keeps it. The fixture is a mock of
      // a real response or it is not worth having — furniture handed to the
      // board down a side channel would prove the renderer draws it and nothing
      // about whether a saved encounter comes back furnished.
      props: furnish(),
    },
    combatants: CAST.map(toCombatant),
  };

  protected readonly selected = signal<string | null>(null);

  /**
   * A fight in progress, so the ring, the bloodied colour and on-deck all show.
   *
   * <p>Held in a signal so a drag can move somebody. There is no server behind
   * this route, and a preview where dragging does nothing is worse than no
   * preview — it reads as a broken renderer rather than as a page with no
   * backend. The engine's rules are absent here by design; what is being shown
   * is that the board picks, drags and redraws.
   */
  protected readonly battle = signal<Battle>({
    id: 'demo-battle',
    name: 'Round two',
    encounterId: 'demo',
    phase: 'IN_TURN',
    round: 2,
    currentParticipantId: 'p-owlbear',
    order: CAST.filter(c => !c.onDeck).map(toParticipant),
    onDeck: CAST.filter(c => c.onDeck).map(toParticipant),
  });

  /**
   * Moves a creature to where it was dropped.
   *
   * <p>The last leg of the path, because the path is what the engine walks and
   * there is no engine here — the preview shows the board, not the rules. On the
   * real route the whole path is posted and the server decides what actually
   * happened, which may be less than the drag asked for.
   */
  protected onMoved(event: {
    id: string;
    path: { xHalfFeet: number; yHalfFeet: number; zHalfFeet: number }[];
  }): void {
    const to = event.path.at(-1);
    if (!to) {
      return;
    }
    const move = (p: Participant): Participant =>
      p.id === event.id ? { ...p, xHalfFeet: to.xHalfFeet, yHalfFeet: to.yHalfFeet } : p;
    const current = this.battle();
    this.battle.set({
      ...current,
      order: current.order.map(move),
      onDeck: current.onDeck.map(move),
    });
  }
}

// region The level
//
// Drawn rather than listed. Two hundred cell literals are unreadable and
// unmaintainable — nobody can see from them that a door lines up with a
// corridor, which is exactly the class of mistake a fixture exists to catch.
// A picture of the level is checkable at a glance and editable with a keyboard.

const CELL = 10;

/**
 * The floor plan.
 *
 * <p><pre>
 *   #  wall          .  floor         +  doorway (floor, with a frame drawn on it)
 *   r  rubble        ~  water         W  deep water
 *   ,  mud           e  web           x  chasm
 *   1  floor  5 ft up              2  floor 10 ft up
 * </pre>
 */
const TERRAIN = [
  '##########################',
  '#.......##........##.....#',
  '#.......##........##.....#',
  '#.......++........++.....#',
  '#.......##........##.....#',
  '#.......##........##.....#',
  '#.....rr##........#+######',
  '####+#####........#.######',
  '####.#####........#.######',
  '####.####+###+##..+112221#',
  '#.rr.....####.#####112221#',
  '#.....,,.#ee....r##112221#',
  '#.~~~~~..#eexx...##111111#',
  '#.~WWW~..+..xx...##......#',
  '#.~WWW~..#..xx.ee##......#',
  '#.~WWW~..#.....ee##......#',
  '#.~~~~~,.####+#####......#',
  '#.~,,,,,.+.r..rr.........#',
  '#.,,,,,,.##########......#',
  '##########################',
];

/** Where the torches are. `b` bright, `d` dim, `k` pitch dark. */
const LIGHT = [
  'dddddddddddddddddddddddddd',
  'dbbbbbbbddbbbbbbbbdddddddd',
  'dbbbbbbbddbbbbbbbbdddddddd',
  'dbbbbbbbddbbbbbbbbdddddddd',
  'dbbbbbbbddbbbbbbbbdddddddd',
  'dbbbbbbbddbbbbbbbbdddddddd',
  'dbbbbbbbddbbbbbbbbdddddddd',
  'ddddddddddbbbbbbbbdddddddd',
  'ddddddddddbbbbbbbbdddddddd',
  'dddddddddddddddddddddbbbdd',
  'dddddddddddddddddddddbbbdd',
  'ddddddddddkkkkkkkddddbbbdd',
  'ddddddddddkkkkkkkddddddddd',
  'ddddddddddkkkkkkkddddddddd',
  'dkkkkdddddkkkkkkkddddddddd',
  'dkkkkdddddkkkkkkkddddddddd',
  'dkkkkddddddddddddddddddddd',
  'dkkkkddddkkkkkkkkkkddddddd',
  'dkkkkddddddddddddddddddddd',
  'dddddddddddddddddddddddddd',
];

const WIDTH = TERRAIN[0].length;
const HEIGHT = TERRAIN.length;

/**
 * Picture row to world square.
 *
 * <p>The pictures above are drawn north-up, the way a floor plan is read. The
 * world's +Y is north, and a top-down camera draws +Y up the screen — so the
 * first row of the picture is the *highest* y, not y = 0. Without this the level
 * rendered mirrored top to bottom: the barracks came out where the flooded
 * undercroft was drawn, every room in the wrong half of the map.
 *
 * <p>A camera cannot fix it. Flipping its up vector rolls it 180° and mirrors
 * east-west as well, and mirroring the scene would invert every model. So the
 * conversion lives here, in the one place that reads a picture, and everything
 * else — the cells, the furniture, the cast — is in picture space and goes
 * through it. Fractions work: row 1.3 is three-tenths of a square south of the
 * middle of row 1.
 */
function worldRow(row: number): number {
  return HEIGHT - 1 - row;
}

/** What a map character means. Anything absent is the map's default floor. */
const TERRAIN_OF: Record<string, Partial<MapCell>> = {
  '#': { terrain: 'WALL' },
  // Difficult Terrain is a cost, not a look: the square costs an extra 5 feet
  // because the cell says so, and would still cost it with every model deleted.
  r: { terrain: 'RUBBLE', extraMoveCostFeet: 5 },
  '~': { terrain: 'WATER', extraMoveCostFeet: 5 },
  W: { terrain: 'DEEP_WATER', extraMoveCostFeet: 5 },
  ',': { terrain: 'MUD', extraMoveCostFeet: 5 },
  e: { terrain: 'WEB', extraMoveCostFeet: 5 },
  x: { terrain: 'CHASM' },
  '1': { elevationFeet: 5 },
  '2': { elevationFeet: 10 },
};

const LIGHT_OF: Record<string, MapCell['light']> = { b: 'BRIGHT', d: 'DIM', k: 'DARKNESS' };

/** Reads the two pictures into the sparse cells the server would have sent. */
function buildLevel(): MapCell[] {
  const cells: MapCell[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const terrain = TERRAIN_OF[TERRAIN[y][x]] ?? {};
      const light = LIGHT_OF[LIGHT[y][x]] ?? null;
      // Sparse, like the real thing: a row is stored only where it differs from
      // the map's defaults, which for a level this size is about a third of it.
      if (Object.keys(terrain).length === 0 && (light === null || light === 'DIM')) {
        continue;
      }
      cells.push({
        x, y: worldRow(y),
        elevationFeet: null, terrain: null, cover: null, opaque: null,
        extraMoveCostFeet: null, notes: null,
        ...terrain,
        light: light === 'DIM' ? null : light,
      });
    }
  }
  return cells;
}

// endregion

// region The furniture

/** How high a table top is, in half-feet — where a plate goes. */
const TABLE_TOP = 5;

/**
 * Everything standing on the floor.
 *
 * <p>Written as a place and a facing rather than as coordinates: `add(piece, 4,
 * 4.5, 1)` is the middle of square (4, 4½) turned a quarter, which is how
 * somebody laying out a room actually thinks. Fractions are half-squares, so a
 * bed can sit against a wall instead of in the middle of its square.
 *
 * <p>Produces exactly what the server stores, so this list could be POSTed to
 * `PUT /encounter/{id}/map/props` unchanged.
 */
function furnish(): MapProp[] {
  const props: MapProp[] = [];
  const add = (piece: PropKind, cx: number, cy: number, facing = 0, lift = 0) =>
    props.push({
      piece,
      xHalfFeet: cx * CELL + CELL / 2,
      yHalfFeet: worldRow(cy) * CELL + CELL / 2,
      zHalfFeet: lift,
      // Quarter-turns, because every piece in the pack is drawn square to an
      // axis and no room needs anything finer — and mirrored, for the same
      // reason `worldRow` exists. The picture is a mirror of the world in Y,
      // and a mirror turns a rotation into its opposite. Author a shelf with
      // its back to the picture's east wall without this and it stands in the
      // room with its back to the shelves opposite.
      facingDegrees: (360 - facing * 90) % 360,
    });

  // A doorway is drawn on the floor square the gap is in, not on a wall square.
  // The engine has to be able to walk through it — a door that was a wall would
  // seal the room — so the frame is art standing on passable ground.
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (TERRAIN[y][x] !== '+') {
        continue;
      }
      const wall = (dx: number, dy: number) => TERRAIN[y + dy]?.[x + dx] === '#';
      add('DOORWAY', x, y, wall(0, -1) || wall(0, 1) ? 1 : 0);
    }
  }

  // The barracks: three bunks, a mess table, and the armoury rack by the door.
  for (const cx of [1, 2.2, 3.4]) {
    add('BED', cx, 1.3);
    add('TRUNK', cx, 2.7);
  }
  add('SHELVES', 6.8, 1.6, 1);
  add('SHELVES', 6.8, 3, 1);
  add('ARMS', 5, 1.05);
  add('TABLE', 4, 4.5, 1);
  for (const cx of [3, 4, 5]) {
    add('STOOL', cx, 3.85);
    add('STOOL', cx, 5.15);
  }
  add('CHAIR', 2.3, 4.5, 1);
  add('PLATE', 3.3, 4.5, 0, TABLE_TOP);
  add('PLATE', 4.7, 4.5, 0, TABLE_TOP);
  add('BOTTLE', 4, 4.35, 0, TABLE_TOP);
  add('CANDLES', 4.4, 4.62, 0, TABLE_TOP);
  add('TORCH', 2, 0.62);
  add('TORCH', 6, 0.62);
  add('TORCH', 0.62, 3, 1);
  add('BANNER_BLUE', 4.6, 0.62);
  add('RUBBLE_SMALL', 6.5, 6);

  // The great hall: a high table across the north end and two benches down it.
  for (const cy of [2.5, 5.5]) {
    add('PILLAR_DECORATED', 10.7, cy);
    add('PILLAR_DECORATED', 16.3, cy);
  }
  add('TABLE', 13.5, 1.6, 1);
  for (const cx of [12.6, 13.5, 14.4]) {
    add('CHAIR', cx, 0.95, 2);
  }
  add('CANDLES', 13.1, 1.6, 0, TABLE_TOP);
  add('CANDLES', 13.9, 1.6, 0, TABLE_TOP);
  for (const cx of [12.2, 15]) {
    add('TABLE', cx, 5);
    for (const cy of [3.6, 4.4, 5.6, 6.4]) {
      add('CHAIR', cx - 0.7, cy, 1);
      add('CHAIR', cx + 0.7, cy, 3);
    }
    add('PLATE', cx, 3.9, 0, TABLE_TOP);
    add('PLATE', cx, 6.1, 0, TABLE_TOP);
    add('BOTTLE', cx, 4.6, 0, TABLE_TOP);
    add('CANDLES', cx, 5.4, 0, TABLE_TOP);
  }
  add('BANNER_GREEN', 11.4, 0.62);
  add('BANNER_BLUE', 15.6, 0.62);
  add('TORCH', 10.62, 4, 1);
  add('TORCH', 16.38, 4, 3);
  add('TORCH', 12, 0.62);
  add('KEG', 16, 7.6);
  add('BARRELS', 10.6, 7.5);

  // The storeroom, which is where everything that is not nailed down went.
  add('BARREL', 20.4, 1.4);
  add('BARREL', 21.2, 1.4);
  add('BARREL', 20.4, 2.2);
  add('BARRELS', 21.3, 2.3);
  add('CRATE', 23.4, 1.5);
  add('CRATES', 23.4, 2.8);
  add('KEG', 20.4, 3.6);
  add('KEG', 21.2, 3.7, 1);
  add('SHELVES', 24.3, 2, 3);
  add('SHELVES', 24.3, 3.5, 3);
  add('TRUNK', 22.2, 4.4);
  add('CRATE', 22.6, 4.6);
  add('SHELF_CANDLES', 19.7, 4.2, 1);

  // The undercroft, flooded from the north-west and barricaded from inside.
  add('RUBBLE', 2.6, 10);
  add('BARRIER', 6, 10.4);
  add('CRATE', 7.3, 12.6);
  add('BARREL', 7.4, 13.6);
  add('BARREL', 7.1, 14.4);
  add('TABLE_BROKEN', 6.6, 16.6, 1);
  add('STOOL', 5.6, 17.4);
  add('TRUNK', 1.4, 11.4);
  add('COINS', 7.5, 17.6);

  // The crypt, unlit, with a fissure down the middle of it.
  add('COLUMN', 10.6, 13.5);
  add('COLUMN', 15.4, 13.5);
  add('ARMS', 12, 11.1);
  add('TABLE_BROKEN', 11, 14.6, 1);
  add('CHEST', 15.4, 11.6);
  add('COINS', 14.8, 11.7);
  add('CANDLES', 10.6, 11.6);
  add('CANDLES', 15.6, 14.6);
  add('SHELF_CANDLES', 9.7, 12.5, 1);
  add('RUBBLE_SMALL', 16, 11);

  // The sanctum: two steps up to a candlelit dais, barricaded at the foot.
  //
  // The staircases are the reason the sanctum steps up twice rather than once:
  // a stair is fixed at a 5-foot rise, so a single 10-foot ledge would need one
  // that visibly stopped half way.
  //
  // Facing north, because a KayKit stair climbs toward +Y unrotated — measured
  // out of the mesh rather than guessed, since a staircase running the wrong
  // way is a bug you only see from one camera angle.
  add('STAIRS', 19.5, 12.9);
  add('STAIRS', 22, 11.9);
  add('PILLAR_DECORATED', 20.4, 9.5);
  add('PILLAR_DECORATED', 20.4, 11.5);
  add('TABLE', 22, 9.8, 1);
  add('CANDLES', 21.4, 9.8, 0, TABLE_TOP);
  add('CANDLES', 22.6, 9.8, 0, TABLE_TOP);
  add('CHEST', 23.3, 10.6);
  add('COINS', 22.9, 11.2);
  add('COINS', 21.2, 10.8);
  add('BANNER_GREEN', 24.4, 10, 3);
  add('BANNER_GREEN', 24.4, 11.4, 3);
  add('TORCH', 20.4, 9.1);
  add('BARRIER', 21, 13.6);
  add('BARRIER', 22.2, 13.6);
  add('TABLE', 22.5, 16, 1);
  for (const cx of [21.8, 22.5, 23.2]) {
    add('STOOL', cx, 16.8);
  }
  add('CRATE', 19.6, 17.4);
  add('BARREL', 20.4, 17.6);
  add('SHELVES', 24.3, 15, 3);
  add('TORCH', 19.62, 15, 1);

  // The collapsed corridor between them.
  add('RUBBLE', 11.3, 17);
  add('RUBBLE', 14.6, 17);
  add('RUBBLE_SMALL', 15.4, 17);
  add('BARRIER', 17, 17, 1);

  return props;
}

// endregion

// region The cast
//
// One list, read twice. The combatants are where everybody was placed and the
// participants are where they are now; keeping them as two hand-written lists
// meant a creature could be in two places at once, which the board would draw
// without complaint.

interface CastMember {
  readonly id: string;
  readonly name: string;
  /** Square, not half-feet, because that is how a DM places a creature. */
  readonly cx: number;
  readonly cy: number;
  /** Side of its space in half-feet: 5 Tiny, 10 Medium, 20 Large, 40 Gargantuan. */
  readonly space: number;
  /** How far off the ground it is, in half-feet. */
  readonly fly?: number;
  readonly hp: readonly [number, number];
  readonly onDeck?: boolean;
}

const CAST: readonly CastMember[] = [
  { id: 'owlbear', name: 'Owlbear', cx: 13, cy: 5, space: 20, hp: [41, 59] },
  { id: 'goblin', name: 'Goblin Warrior', cx: 11, cy: 3, space: 10, hp: [3, 12] },
  { id: 'goblin2', name: 'Goblin Warrior', cx: 16, cy: 7, space: 10, hp: [12, 12] },
  { id: 'captain', name: 'Bandit Captain', cx: 22, cy: 3, space: 10, hp: [52, 65] },
  { id: 'zombie', name: 'Zombie', cx: 3, cy: 4, space: 10, hp: [8, 22] },
  { id: 'skeleton', name: 'Skeleton', cx: 15, cy: 14, space: 10, hp: [13, 13] },
  { id: 'skeleton2', name: 'Skeleton', cx: 16, cy: 15, space: 10, hp: [0, 13] },
  { id: 'spider', name: 'Giant Spider', cx: 10, cy: 11, space: 20, hp: [26, 26] },
  { id: 'wolf', name: 'Dire Wolf', cx: 12, cy: 17, space: 20, hp: [37, 37] },
  // Flying over the fissure: elevation and flight are one axis, which is the
  // whole reason a creature ten feet up and one on a ledge draw the same way.
  { id: 'imp', name: 'Imp', cx: 14, cy: 13, space: 5, fly: 30, hp: [10, 10] },
  // On the dais, twenty feet of stairs above the floor of its own room.
  { id: 'giant', name: 'Hill Giant', cx: 22, cy: 10, space: 30, hp: [105, 105] },
  // Gargantuan, in the deep water. Its space is 20 feet across, so it is the
  // one creature on the board that shows whether a footprint is really drawn.
  { id: 'worm', name: 'Purple Worm', cx: 4, cy: 14, space: 40, hp: [143, 247] },
  { id: 'rat', name: 'Giant Rat', cx: 7, cy: 12, space: 10, hp: [7, 7], onDeck: true },
];

function toCombatant(c: CastMember): Combatant {
  return {
    id: `c-${c.id}`,
    statBlockId: `sb-${c.id}`,
    gameCharacterId: null,
    name: c.name,
    xHalfFeet: c.cx * CELL + CELL / 2,
    yHalfFeet: worldRow(c.cy) * CELL + CELL / 2,
    zHalfFeet: c.fly ?? 0,
    disposition: c.onDeck ? 'ON_DECK' : 'ACTIVE',
    surprised: false,
    size: null,
    spaceHalfFeet: c.space,
    capabilities: [],
  };
}

function toParticipant(c: CastMember): Participant {
  const [current, max] = c.hp;
  return {
    id: `p-${c.id}`,
    name: c.name,
    initiative: 12,
    currentHitPoints: current,
    maxHitPoints: max,
    down: current <= 0,
    bloodied: current > 0 && current * 2 <= max,
    conditions: [],
    disposition: c.onDeck ? 'ON_DECK' : 'ACTIVE',
    xHalfFeet: c.cx * CELL + CELL / 2,
    yHalfFeet: worldRow(c.cy) * CELL + CELL / 2,
    zHalfFeet: c.fly ?? 0,
    speedFeet: 30,
    movementRemainingFeet: 30,
    combatantId: `c-${c.id}`,
  };
}

// endregion
