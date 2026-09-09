import {
  LIGHT_FACTOR, TOKEN_LIFT, WALL_HEIGHT, cellSize, coverBonus, groundAt, opaqueAt,
  placedProps, sceneForBattle, sceneForEncounter, shade, terrainTiles,
} from './board-scene';
import {
  Battle, BattleMap, Combatant, Encounter, MapCell, Participant, PropPlacement,
} from './board.models';

/**
 * What the board shows.
 *
 * <p>Asserted here rather than inside the renderer because jsdom has no WebGL
 * context — anything checked against a real scene could not run at all. Keeping
 * the rules in a pure function is what makes them testable, and it is the same
 * discipline the action resolver follows on the server.
 */
describe('board scene', () => {

  function cell(x: number, y: number, over: Partial<MapCell> = {}): MapCell {
    return {
      x, y, elevationFeet: null, terrain: null, light: null, cover: null, opaque: null,
      extraMoveCostFeet: null, notes: null, ...over,
    };
  }

  function map(over: Partial<BattleMap> = {}): BattleMap {
    return {
      id: 'm', width: 4, height: 3, cellFeet: 5,
      defaultTerrain: 'FLOOR', defaultLight: 'BRIGHT', cells: [], ...over,
    };
  }

  function combatant(over: Partial<Combatant> = {}): Combatant {
    return {
      id: 'c1', statBlockId: 'sb1', gameCharacterId: null,
      name: 'Owlbear', xHalfFeet: 20, yHalfFeet: 20, zHalfFeet: 0,
      disposition: 'ACTIVE', surprised: false, size: 'LARGE', spaceHalfFeet: 20,
      capabilities: [], ...over,
    };
  }

  function participant(over: Partial<Participant> = {}): Participant {
    return {
      id: 'p1', name: 'Owlbear', initiative: 14, currentHitPoints: 59, maxHitPoints: 59,
      down: false, bloodied: false, conditions: [], disposition: 'ACTIVE',
      xHalfFeet: 20, yHalfFeet: 20, zHalfFeet: 0, speedFeet: 40, movementRemainingFeet: 40,
      combatantId: 'c1', ...over,
    };
  }

  describe('terrain', () => {

    it('draws every square, not only the painted ones', () => {
      // Storage is sparse because most squares are the map's default; a
      // renderer still has to draw those.
      expect(terrainTiles(map())).toHaveLength(12);
    });

    it('centres a tile on its square rather than its corner', () => {
      const [first] = terrainTiles(map());

      // A token's position is a centre, and mixing the two is the kind of
      // half-cell drift nobody sees until a Gargantuan creature is a square off.
      expect(first.x).toBe(5);
      expect(first.y).toBe(5);
      expect(first.size).toBe(10);
    });

    it('gives a wall real height and leaves floor flat', () => {
      const tiles = terrainTiles(map({ cells: [cell(1, 1, { terrain: 'WALL' })] }));
      const wall = tiles.find(t => t.kind === 'WALL')!;
      const floor = tiles.find(t => t.kind === 'FLOOR')!;

      // This is the whole of building for 3D: the geometry is three-dimensional
      // now, and only the camera is locked. Swap the camera and the wall is
      // already a wall.
      expect(wall.height).toBe(WALL_HEIGHT);
      expect(floor.height).toBe(0);
    });

    it('raises a tile onto its elevation', () => {
      const tiles = terrainTiles(map({ cells: [cell(2, 2, { elevationFeet: 15 })] }));
      const ledge = tiles.find(t => t.x === 25 && t.y === 25)!;

      // Feet in the API, half-feet in the world — the engine's unit, so the
      // renderer never rounds.
      expect(ledge.base).toBe(30);
    });

    it('darkens a tile by its light level rather than recolouring it', () => {
      const lit = terrainTiles(map())[0];
      const dark = terrainTiles(map({ defaultLight: 'DARKNESS' }))[0];

      // A multiplier, so the same numbers become light intensities when a
      // perspective camera and real lights arrive.
      expect(LIGHT_FACTOR.DARKNESS).toBeLessThan(LIGHT_FACTOR.BRIGHT);
      expect(dark.colour).toBeLessThan(lit.colour);
      // The material itself is untouched, so a renderer with real lights can
      // apply the level once instead of inheriting it already applied.
      expect(dark.baseColour).toBe(lit.baseColour);
      expect(shade(0xffffff, 0.5)).toBe(0x808080);
    });

    it('reads opacity the way the server does', () => {
      const m = map({ cells: [cell(0, 0, { terrain: 'WALL' }), cell(1, 0, { opaque: false, terrain: 'WALL' })] });

      // A board that drew different walls from the ones the engine traces
      // through would be worse than no board.
      expect(opaqueAt(m, m.cells[0])).toBe(true);
      expect(opaqueAt(m, m.cells[1])).toBe(false);
      expect(opaqueAt(m, null)).toBe(false);
    });

    it('turns a wall to run along the wall it is part of', () => {
      // A wall model is long and thin. Left alone, a room's side walls face the
      // same way as its top and bottom and the run comes out as a dashed line
      // of gaps — which reads as a broken renderer rather than as a wall
      // pointing the wrong way.
      const northSouth = map({ cells: [
        cell(0, 0, { terrain: 'WALL' }), cell(0, 1, { terrain: 'WALL' }),
        cell(0, 2, { terrain: 'WALL' })] });
      const eastWest = map({ cells: [
        cell(0, 0, { terrain: 'WALL' }), cell(1, 0, { terrain: 'WALL' }),
        cell(2, 0, { terrain: 'WALL' })] });

      expect(terrainTiles(northSouth).find(t => t.x === 5 && t.y === 15)!.rotation)
        .toBeCloseTo(Math.PI / 2);
      expect(terrainTiles(eastWest).find(t => t.x === 15 && t.y === 5)!.rotation).toBe(0);
    });

    it('leaves a corner and a lone piece alone', () => {
      // A corner is a different model, and guessing an angle for one would be
      // worse than not turning it.
      const corner = map({ cells: [
        cell(0, 0, { terrain: 'WALL' }), cell(1, 0, { terrain: 'WALL' }),
        cell(0, 1, { terrain: 'WALL' })] });

      expect(terrainTiles(corner).find(t => t.x === 5 && t.y === 5)!.rotation).toBe(0);
      expect(terrainTiles(map({ cells: [cell(2, 2, { terrain: 'WALL' })] }))
        .find(t => t.x === 25 && t.y === 25)!.rotation).toBe(0);
    });

    it('gives a wall Total Cover without being told', () => {
      const tiles = terrainTiles(map({ cells: [cell(0, 0, { terrain: 'WALL' })] }));

      expect(tiles[0].cover).toBe('TOTAL');
      expect(coverBonus('HALF')).toBe(2);
      expect(coverBonus('THREE_QUARTERS')).toBe(5);
    });
  });

  describe('tokens', () => {

    const encounter: Encounter = {
      id: 'e', name: 'Ford', map: map({ cells: [cell(3, 3, { elevationFeet: 10 })] }),
      combatants: [combatant()],
    };

    it('sizes a token by its footprint, not by an icon', () => {
      const [token] = sceneForEncounter(encounter).tokens;

      // A Large creature covers the ten feet it occupies; a Gargantuan one
      // covers twenty.
      expect(token.size).toBe(20);
    });

    it('stands a token on the ground under it', () => {
      const onLedge = sceneForEncounter({
        ...encounter,
        combatants: [combatant({ xHalfFeet: 35, yHalfFeet: 35 })],
      }).tokens[0];

      // 10 feet of ground, in half-feet, plus the lift that keeps it off the
      // floor's surface.
      expect(onLedge.z).toBe(20 + TOKEN_LIFT);
    });

    it('adds flight to the ground rather than replacing it', () => {
      const flying = sceneForEncounter({
        ...encounter,
        combatants: [combatant({ xHalfFeet: 35, yHalfFeet: 35, zHalfFeet: 30 })],
      }).tokens[0];

      // Elevation and flight are one axis, so a creature on a balcony and one
      // hovering draw the same way.
      expect(flying.z).toBe(20 + 30 + TOKEN_LIFT);
    });

    it('fades an on-deck creature and does not hide it', () => {
      const [token] = sceneForEncounter({
        ...encounter,
        combatants: [combatant({ disposition: 'ON_DECK' })],
      }).tokens;

      // It is on the board — the ambush from the balcony is placed before it
      // joins — so it draws, differently.
      expect(token.onDeck).toBe(true);
    });

    it('leaves out anything removed from the board', () => {
      expect(sceneForEncounter({
        ...encounter,
        combatants: [combatant({ disposition: 'REMOVED' })],
      }).tokens).toHaveLength(0);
    });
  });

  describe('during a fight', () => {

    const encounter: Encounter = {
      id: 'e', name: 'Ford', map: map(), combatants: [combatant()],
    };

    function battle(over: Partial<Battle> = {}): Battle {
      return {
        id: 'b', name: 'Round one', encounterId: 'e', phase: 'IN_TURN', round: 1,
        currentParticipantId: null, order: [participant()], onDeck: [], ...over,
      };
    }

    it('draws creatures where they are, not where they started', () => {
      const scene = sceneForBattle(encounter,
        battle({ order: [participant({ xHalfFeet: 120, yHalfFeet: 60 })] }));

      // The combatant is still at 20,20. Drawing that during a fight would
      // paint everyone back at their opening marks.
      expect(scene.tokens[0].x).toBe(120);
      expect(scene.tokens[0].y).toBe(60);
    });

    it('takes the footprint from the combatant it came from', () => {
      const scene = sceneForBattle(encounter, battle());

      // The tracker deliberately carries no size — it is a fight, not a board —
      // so the size comes back across the link.
      expect(scene.tokens[0].size).toBe(20);
    });

    it('falls back to Medium for a creature the tracker invented', () => {
      const scene = sceneForBattle(encounter,
        battle({ order: [participant({ combatantId: null })] }));

      // A DM typing "Bandit" into the tracker is the standalone case, and it
      // has to draw.
      expect(scene.tokens[0].size).toBe(10);
    });

    it('rings whoever is acting, and nobody between turns', () => {
      const acting = sceneForBattle(encounter, battle({ currentParticipantId: 'p1' }));
      const paused = sceneForBattle(encounter, battle({ currentParticipantId: null }));

      // currentParticipantId goes null between turns, so the ring goes with it
      // rather than leaving somebody highlighted who has finished.
      expect(acting.tokens[0].acting).toBe(true);
      expect(paused.tokens[0].acting).toBe(false);
    });

    it('colours a bloodied creature differently from a healthy one, and a downed one again', () => {
      const healthy = sceneForBattle(encounter, battle()).tokens[0];
      const hurt = sceneForBattle(encounter,
        battle({ order: [participant({ bloodied: true })] })).tokens[0];
      const down = sceneForBattle(encounter,
        battle({ order: [participant({ bloodied: true, down: true })] })).tokens[0];

      expect(new Set([healthy.colour, hurt.colour, down.colour]).size).toBe(3);
    });

    it('draws the on-deck list as well as the order', () => {
      const scene = sceneForBattle(encounter, battle({
        onDeck: [participant({ id: 'p2', name: 'Lurker', disposition: 'ON_DECK' })],
      }));

      expect(scene.tokens).toHaveLength(2);
      expect(scene.tokens.filter(t => t.onDeck)).toHaveLength(1);
    });
  });

  describe('props', () => {

    function prop(over: Partial<PropPlacement> = {}): PropPlacement {
      return { piece: 'BARREL', x: 5, y: 5, z: 0, rotation: 0, ...over };
    }

    const encounter: Encounter = {
      id: 'e', name: 'Ford', map: map(), combatants: [combatant()],
    };

    const battle: Battle = {
      id: 'b', name: 'Round one', encounterId: 'e', phase: 'IN_TURN', round: 1,
      currentParticipantId: null, order: [participant()], onDeck: [],
    };

    it('stands a prop on the floor under it, not at absolute zero', () => {
      // A chest carried up onto a ten-foot dais should not need its own
      // elevation edited, and one authored at z = 0 must not end up buried in
      // the plinth. So a prop's z is a height above its ground, like a
      // creature's.
      const m = map({ cells: [cell(1, 0, { elevationFeet: 10 })] });

      const [onFloor, onLedge] = placedProps(m, [prop(), prop({ x: 15, y: 5 })]);

      expect(onFloor.z).toBe(0);
      expect(onLedge.z).toBe(20);
    });

    it('keeps a prop lifted above the ledge it stands on', () => {
      const m = map({ cells: [cell(1, 0, { elevationFeet: 10 })] });

      // A candle on a table on a dais: 10 feet of dais plus 2½ feet of table.
      expect(placedProps(m, [prop({ x: 15, y: 5, z: 5 })])[0].z).toBe(25);
    });

    it('carries props into the scene for an encounter and for a battle', () => {
      const props = [prop(), prop({ piece: 'TABLE' })];

      expect(sceneForEncounter(encounter, props).props).toHaveLength(2);
      expect(sceneForBattle(encounter, battle, props).props).toHaveLength(2);
    });

    it('draws no furniture when none was placed', () => {
      // Not undefined: the renderer iterates it, and a board with nothing in it
      // is a normal board rather than a special case.
      expect(sceneForEncounter(encounter).props).toEqual([]);
    });
  });

  it('measures the board in half-feet, the engine unit', () => {
    const scene = sceneForEncounter({
      id: 'e', name: 'Big', map: map({ width: 20, height: 10, cellFeet: 5 }), combatants: [],
    });

    // 20 cells of 5 feet is 100 feet is 200 half-feet — no rounding anywhere,
    // which is why the unit is carried rather than converted.
    expect(cellSize(map())).toBe(10);
    expect(scene.widthHalfFeet).toBe(200);
    expect(scene.heightHalfFeet).toBe(100);
  });

  it('groundAt reads the elevation under a point', () => {
    const m = map({ cells: [cell(1, 0, { elevationFeet: 20 })] });

    expect(groundAt(m, 15, 5)).toBe(40);
    expect(groundAt(m, 5, 5)).toBe(0);
  });
});
