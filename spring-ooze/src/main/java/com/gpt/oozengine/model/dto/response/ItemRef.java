package com.gpt.oozengine.model.dto.response;

import com.gpt.oozengine.model.Item;
import java.util.UUID;

/**
 * An item named from another item — what a tool crafts, what a magic item is
 * applied to, what a weapon fires. Just enough to render a link and follow it;
 * the full row is a fetch away, and embedding it would make a Longsword's
 * response drag in every magic sword that mentions it.
 */
public record ItemRef(UUID id, String name) {

  public static ItemRef of(Item item) {
    return item == null ? null : new ItemRef(item.getId(), item.getName());
  }
}
