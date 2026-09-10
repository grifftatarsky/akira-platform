package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.Disposition;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;

/**
 * Someone in the fight.
 *
 * <p>Everything but the name and hit points is optional, and the ids are all
 * nullable, because the tracker has to work for a DM who is typing "Bandit" and
 * a number rather than lifting a creature off a board.
 *
 * @param initiativeTiebreak usually the Dexterity score, which is the common
 *     table convention. Stored rather than derived so two participants with no
 *     stat block behind them still order deterministically.
 * @param surprised caught unawares: Disadvantage on the Initiative roll, and
 *     nothing else
 */
public record ParticipantRequest(
    @NotBlank String name,
    @Min(1) int maxHitPoints,
    Integer initiativeBonus,
    Integer initiativeTiebreak,
    Boolean surprised,
    Disposition disposition,
    UUID statBlockId,
    UUID gameCharacterId,
    UUID combatantId,
    String notes) {}
