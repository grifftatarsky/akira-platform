package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.Disposition;
import jakarta.validation.constraints.Min;
import java.util.UUID;

/**
 * Something to put on the board.
 *
 * <p><b>Positions are in half-feet, and the field names say so.</b> That is the
 * engine's length unit throughout: every distance the SRD states is a multiple
 * of 5 feet, and the one exception — a Tiny creature's 2 1/2-foot square — is an
 * integer in half-feet. Speaking feet at the API boundary would put a rounding
 * decision on every placement, which is the one place it must not be.
 *
 * @param statBlockId a monster straight from the compendium
 * @param gameCharacterId a PC or named NPC, which carries its own inventory and
 *     slots; exactly one of the two must be set
 * <p>The coordinates are boxed and default to zero when absent. Placing a
 * creature on the ground is the common case, and Jackson maps an omitted field
 * to null, which a primitive rejects outright — so requiring "zHalfFeet": 0 on
 * every placement would be a 400 for the most ordinary request there is.
 *
 * @param maxHitPoints overrides the base's hit points, for a beefed-up goblin
 * @param size overrides the base's size, which changes the footprint and so
 *     changes reach and cover
 */
public record CombatantRequest(
    UUID statBlockId,
    UUID gameCharacterId,
    String name,
    Integer xHalfFeet,
    Integer yHalfFeet,
    Integer zHalfFeet,
    Disposition disposition,
    Boolean surprised,
    @Min(1) Integer maxHitPoints,
    CreatureSize size,
    String notes) {}
