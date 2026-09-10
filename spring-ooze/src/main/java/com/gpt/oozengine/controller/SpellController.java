package com.gpt.oozengine.controller;

import com.gpt.oozengine.model.dto.request.SpellRequest;
import com.gpt.oozengine.model.dto.response.SpellResponse;
import com.gpt.oozengine.service.AbstractCatalogService;
import com.gpt.oozengine.service.SpellService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("spell")
@Tag(name = "Spells")
@RequiredArgsConstructor
public class SpellController extends AbstractCatalogController<SpellRequest, SpellResponse> {

  private final SpellService spellService;

  @Override
  protected AbstractCatalogService<?, SpellRequest, SpellResponse> service() {
    return spellService;
  }
}
