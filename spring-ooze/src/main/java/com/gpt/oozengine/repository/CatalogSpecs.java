package com.gpt.oozengine.repository;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.model.CatalogContent;
import com.gpt.oozengine.model.HiddenContent;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.NoArgsConstructor;
import org.springframework.data.jpa.domain.Specification;

/**
 * The catalog's visibility and filter predicates, written once against
 * {@link CatalogContent}'s own columns so they apply to every content type.
 *
 * <p>These used to be applied in memory after loading a whole table, which was
 * fine at a few dozen rows and stopped being fine at 330 creatures — paging a
 * list you have already fully loaded saves nothing. As specifications they run
 * in the database and compose, so a new finder filter is one more method here
 * rather than another parameter threaded through a hand-written query.
 */
@NoArgsConstructor(access = AccessLevel.PRIVATE)
public final class CatalogSpecs {

  /**
   * What a caller may see: their own rows, plus the base rows they have neither
   * overridden nor hidden. An anonymous caller sees base content only.
   *
   * <p>The "has an override" subquery is over the same table as the row itself,
   * which is why it reads the entity type off the root rather than naming one —
   * the whole point of this class is that it doesn't know which catalog it is.
   */
  public static <E extends CatalogContent> Specification<E> visibleTo(
      UUID userId, ContentType type) {
    return (root, query, cb) -> {
      if (userId == null) {
        return cb.isNull(root.get("ownerId"));
      }

      @SuppressWarnings("unchecked") // Root<E>#getJavaType is this entity, by definition.
      Class<E> entity = (Class<E>) root.getJavaType();

      Subquery<UUID> overridden = query.subquery(UUID.class);
      Root<E> mine = overridden.from(entity);
      overridden
          .select(mine.get("id"))
          .where(
              cb.equal(mine.get("ownerId"), userId),
              cb.equal(mine.get("overridesId"), root.get("id")));

      Subquery<UUID> hidden = query.subquery(UUID.class);
      Root<HiddenContent> h = hidden.from(HiddenContent.class);
      hidden
          .select(h.get("id"))
          .where(
              cb.equal(h.get("ownerId"), userId),
              cb.equal(h.get("contentType"), type),
              cb.equal(h.get("baseId"), root.get("id")));

      return cb.or(
          cb.equal(root.get("ownerId"), userId),
          cb.and(
              cb.isNull(root.get("ownerId")),
              cb.not(cb.exists(overridden)),
              cb.not(cb.exists(hidden))));
    };
  }

  /** Case-insensitive name match; unrestricted when there's nothing to match. */
  public static <E extends CatalogContent> Specification<E> nameContains(String query) {
    if (query == null || query.isBlank()) {
      return Specification.unrestricted();
    }
    String like = "%" + query.trim().toLowerCase() + "%";
    return (root, q, cb) -> cb.like(cb.lower(root.get("name")), like);
  }

  /**
   * Drops SRD 5.1 rows for a caller who has the legacy toggle off. A row with no
   * SRD version at all is a DM's own creation and always stays: the toggle is
   * about which edition of the book to show, not about hiding homebrew.
   */
  public static <E extends CatalogContent> Specification<E> excludingLegacy() {
    return (root, q, cb) ->
        cb.or(
            cb.isNull(root.get("srdVersion")),
            cb.notEqual(root.get("srdVersion"), SrdVersion.SRD_5_1));
  }
}
