package com.gpt.oozengine.controller;

import com.gpt.oozengine.model.dto.request.WeaponMasteryRequest;
import com.gpt.oozengine.model.dto.response.WeaponMasteryResponse;
import com.gpt.oozengine.service.AbstractCatalogService;
import com.gpt.oozengine.service.WeaponMasteryService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("weapon-mastery")
@Tag(name = "Weapon Mastery")
@RequiredArgsConstructor
public class WeaponMasteryController
    extends AbstractCatalogController<WeaponMasteryRequest, WeaponMasteryResponse> {

  private final WeaponMasteryService weaponMasteryService;

  @Override
  protected AbstractCatalogService<?, WeaponMasteryRequest, WeaponMasteryResponse> service() {
    return weaponMasteryService;
  }
}
