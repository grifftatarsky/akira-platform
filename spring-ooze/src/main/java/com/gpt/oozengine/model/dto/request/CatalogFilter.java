package com.gpt.oozengine.model.dto.request;

/**
 * The finder's query parameters, in one object so a new filter is a new
 * component rather than another argument on every signature between the
 * controller and the repository.
 *
 * @param query case-insensitive name fragment, or null for everything
 * @param includeLegacy whether SRD 5.1 rows count; the finder's edition toggle
 */
public record CatalogFilter(String query, boolean includeLegacy) {

  public CatalogFilter {
    query = query == null || query.isBlank() ? null : query.trim();
  }

  /** No filtering: the whole catalog, both editions. */
  public static CatalogFilter all() {
    return new CatalogFilter(null, true);
  }
}
