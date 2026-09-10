package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.constant.rules.MasteryCode;
import com.gpt.oozengine.model.WeaponMastery;
import java.util.UUID;

public record WeaponMasteryResponse(
    UUID id,
    String name,
    String description,
    MasteryCode code,
    boolean base,
    UUID overridesId,
    SrdVersion srdVersion) {

  public static WeaponMasteryResponse from(WeaponMastery w) {
    return new WeaponMasteryResponse(
        w.getId(),
        w.getName(),
        w.getDescription(),
        w.getCode(),
        w.isBaseContent(),
        w.getOverridesId(),
        w.getSrdVersion());
  }
}
