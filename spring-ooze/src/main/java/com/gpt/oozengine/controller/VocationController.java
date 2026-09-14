package com.gpt.oozengine.controller;

import com.gpt.oozengine.model.dto.request.VocationRequest;
import com.gpt.oozengine.model.dto.response.VocationResponse;
import com.gpt.oozengine.service.AbstractCatalogService;
import com.gpt.oozengine.service.VocationService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("vocation")
@Tag(name = "Classes")
@RequiredArgsConstructor
public class VocationController extends AbstractCatalogController<VocationRequest, VocationResponse> {

  private final VocationService vocationService;

  @Override
  protected AbstractCatalogService<?, VocationRequest, VocationResponse> service() {
    return vocationService;
  }
}
