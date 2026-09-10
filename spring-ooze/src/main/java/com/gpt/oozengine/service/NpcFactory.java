package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.CharacterKind;
import com.gpt.oozengine.model.GameCharacter;
import com.gpt.oozengine.model.creature.StatBlock;
import java.util.UUID;

/**
 * Building an NPC out of a monster.
 *
 * <p>An NPC wraps a monster the way a character wraps a species. "Grish, goblin
 * boss, three levels of Fighter, carrying a magic sword" is a
 * {@link GameCharacter} whose stat block started life as a copy of the Goblin
 * Boss's and then grew an inventory, a level and hit points of its own.
 *
 * <p>The payoff is that PCs, NPCs and monsters are one type to the engine: the
 * initiative order, the action menu and the log never ask which they are looking
 * at.
 *
 * <p>A copy rather than a reference, because an NPC is a specific creature and
 * the compendium's Goblin Boss is a template. Re-importing the SRD must not
 * silently rearm somebody's named villain.
 */
public final class NpcFactory {

  private NpcFactory() {}

  /** A named NPC derived from a creature, owned by one DM. */
  public static GameCharacter fromStatBlock(UUID ownerId, String name, StatBlock base) {
    GameCharacter npc = new GameCharacter();
    npc.setOwnerId(ownerId);
    npc.setKind(CharacterKind.NPC);
    npc.setName(name);
    npc.setBaseStatBlockId(base.getId());
    npc.setStatBlock(StatBlockCloner.deepCopy(base));
    return npc;
  }
}
