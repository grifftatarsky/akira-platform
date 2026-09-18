package com.gpt.oozengine.controller;

import com.gpt.oozengine.model.dto.request.ConditionRequest;
import com.gpt.oozengine.model.dto.response.ConditionResponse;
import com.gpt.oozengine.service.AbstractCatalogService;
import com.gpt.oozengine.service.ConditionService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("condition")
@Tag(name = "Conditions")
@RequiredArgsConstructor
public class ConditionController
    extends AbstractCatalogController<ConditionRequest, ConditionResponse> {

  private final ConditionService conditionService;

  @Override
  protected AbstractCatalogService<?, ConditionRequest, ConditionResponse> service() {
    return conditionService;
  }
}
