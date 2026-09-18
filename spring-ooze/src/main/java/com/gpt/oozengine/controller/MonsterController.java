package com.gpt.oozengine.controller;

import com.gpt.oozengine.model.dto.request.MonsterRequest;
import com.gpt.oozengine.model.dto.response.MonsterResponse;
import com.gpt.oozengine.service.AbstractCatalogService;
import com.gpt.oozengine.service.MonsterService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("monster")
@Tag(name = "Bestiary")
@RequiredArgsConstructor
public class MonsterController extends AbstractCatalogController<MonsterRequest, MonsterResponse> {

  private final MonsterService monsterService;

  @Override
  protected AbstractCatalogService<?, MonsterRequest, MonsterResponse> service() {
    return monsterService;
  }
}
