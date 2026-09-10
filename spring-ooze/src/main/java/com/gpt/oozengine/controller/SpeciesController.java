package com.gpt.oozengine.controller;

import com.gpt.oozengine.model.dto.request.SpeciesRequest;
import com.gpt.oozengine.model.dto.response.SpeciesResponse;
import com.gpt.oozengine.service.AbstractCatalogService;
import com.gpt.oozengine.service.SpeciesService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("species")
@Tag(name = "Species")
@RequiredArgsConstructor
public class SpeciesController extends AbstractCatalogController<SpeciesRequest, SpeciesResponse> {

  private final SpeciesService speciesService;

  @Override
  protected AbstractCatalogService<?, SpeciesRequest, SpeciesResponse> service() {
    return speciesService;
  }
}
