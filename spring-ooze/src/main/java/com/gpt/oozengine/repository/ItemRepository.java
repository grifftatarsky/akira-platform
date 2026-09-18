package com.gpt.oozengine.repository;

import com.gpt.oozengine.constant.rules.ItemCategory;
import com.gpt.oozengine.model.Item;
import java.util.List;
import org.springframework.data.domain.Sort;

public interface ItemRepository extends CatalogRepository<Item> {

  /** Base rows of one kind — what the editor's ammunition picker offers. */
  List<Item> findByOwnerIdIsNullAndItemCategory(ItemCategory itemCategory, Sort sort);
}
