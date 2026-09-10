package com.gpt.oozengine.controller;

import com.gpt.oozengine.constant.rules.ItemCategory;
import com.gpt.oozengine.model.dto.request.ItemRequest;
import com.gpt.oozengine.model.dto.response.ItemResponse;
import com.gpt.oozengine.service.AbstractCatalogService;
import com.gpt.oozengine.service.ItemService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("item")
@Tag(name = "Items")
@RequiredArgsConstructor
public class ItemController extends AbstractCatalogController<ItemRequest, ItemResponse> {

  private final ItemService itemService;

  @Override
  protected AbstractCatalogService<?, ItemRequest, ItemResponse> service() {
    return itemService;
  }

  /**
   * Every base item of one category. The editor's pickers need whole closed
   * sets — the five kinds of ammunition, the thirteen armors — which a page of
   * names sorted alphabetically will not give them.
   */
  @GetMapping("/by-category/{category}")
  public List<ItemResponse> byCategory(@PathVariable ItemCategory category) {
    return itemService.byCategory(category);
  }
}
