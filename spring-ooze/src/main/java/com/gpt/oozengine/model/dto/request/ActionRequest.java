package com.gpt.oozengine.model.dto.request;

import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;

/**
 * What the acting creature is doing.
 *
 * @param featureId which of its features; looked up on the actor's own stat
 *     block, so a DM cannot make a goblin breathe fire by sending an id
 * @param targetIds whom it is aimed at, in order. Empty for a feature that
 *     targets nobody.
 */
public record ActionRequest(
    @NotNull UUID featureId,
    List<UUID> targetIds) {

  public List<UUID> targets() {
    return targetIds == null ? List.of() : targetIds;
  }
}
