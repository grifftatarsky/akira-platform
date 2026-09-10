package com.gpt.oozengine.model.dto.request;

import com.gpt.oozengine.constant.rules.Alignment;
import com.gpt.oozengine.constant.rules.CreatureSize;
import com.gpt.oozengine.constant.rules.CreatureType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

/**
 * A monster.
 *
 * <p>The catalog fields are the monster's; everything mechanical lives in
 * {@link StatBlockRequest}. A null {@code statBlock} leaves the creature's
 * mechanics untouched, which is what lets a rename or a flavour-text edit go
 * through without the client having to round-trip the whole block.
 */
public record MonsterRequest(
    @NotBlank String name, String description, @Valid StatBlockRequest statBlock) {}
