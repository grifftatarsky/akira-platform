package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.ContentType;
import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.model.CatalogContent;
import com.gpt.oozengine.model.HiddenContent;
import com.gpt.oozengine.model.dto.request.CatalogFilter;
import com.gpt.oozengine.repository.CatalogRepository;
import com.gpt.oozengine.repository.CatalogSpecs;
import com.gpt.oozengine.repository.HiddenContentRepository;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * The per-user override mechanics shared by every catalog content type. Base
 * rows (ownerId null) are shared and immutable; editing one copy-on-writes the
 * caller's owned override (overridesId → base), "revert" deletes that override,
 * and hiding is recorded in {@code hidden_content} rather than copied.
 *
 * <p>Subclasses supply the repository, content type, and the entity↔DTO mapping;
 * all the ownership/visibility rules live here so they can't drift per type.
 *
 * @param <E> the content entity
 * @param <REQ> create/update payload
 * @param <RES> response DTO
 */
public abstract class AbstractCatalogService<E extends CatalogContent, REQ, RES> {

  protected abstract CatalogRepository<E> repo();

  protected abstract HiddenContentRepository hiddenRepo();

  protected abstract ContentType contentType();

  protected abstract E instantiate();

  protected abstract void apply(REQ req, E entity);

  protected abstract RES toResponse(E entity);

  /**
   * The shape a row takes in a list, which need not be the shape it takes on its
   * own. Defaults to the full response; a type whose detail is large — a
   * creature carries its whole stat block — overrides this to leave the heavy
   * part out, and the client fetches it per row when one is opened.
   */
  protected RES toListResponse(E entity) {
    return toResponse(entity);
  }

  /**
   * How a type's rows read best in a list. Name for almost everything; spells
   * are conventionally grouped by level first. Applied when the request doesn't
   * ask for its own sort, and always applied to *something*, because an
   * unordered page 2 can repeat rows from page 1.
   */
  protected Sort defaultSort() {
    return Sort.by(Sort.Order.asc("name").ignoreCase());
  }

  /**
   * One page of what the caller can see, filtered by name and ordered by the
   * database rather than in memory.
   *
   * <p>Rows come back as {@link #toListResponse}, which for a large type is a
   * summary — the client fetches the detail for the row it opens.
   */
  @Transactional(readOnly = true)
  public Page<RES> page(UUID userId, CatalogFilter filter, Pageable pageable) {
    Specification<E> spec =
        CatalogSpecs.<E>visibleTo(userId, contentType())
            .and(CatalogSpecs.nameContains(filter.query()));
    if (!filter.includeLegacy()) {
      spec = spec.and(CatalogSpecs.excludingLegacy());
    }
    Pageable paged =
        pageable.getSort().isSorted()
            ? pageable
            : PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), defaultSort());
    return repo().findAll(spec, paged).map(this::toListResponse);
  }

  /** The SRD editions this catalog draws on, newest first. */
  @Transactional(readOnly = true)
  public List<SrdVersion> editions() {
    return repo().findDistinctSrdVersions().stream().sorted().toList();
  }

  @Transactional(readOnly = true)
  public RES get(UUID id, UUID userId) {
    return toResponse(readable(id, userId));
  }

  @Transactional
  public RES create(REQ req, UUID userId) {
    E e = instantiate();
    apply(req, e);
    e.setOwnerId(userId);
    e.setOverridesId(null);
    return toResponse(repo().save(e));
  }

  @Transactional
  public RES update(UUID id, REQ req, UUID userId) {
    E e = repo().findById(id).orElseThrow(AbstractCatalogService::notFound);
    if (e.isBaseContent()) {
      // Copy-on-write: edit (or create) this user's override of the base row.
      E existing = repo().findByOwnerIdAndOverridesId(userId, id).orElse(null);
      E override = existing != null ? existing : instantiate();
      if (existing == null) {
        // The "copy" in copy-on-write. Anything the request can't carry has to
        // be taken from the base row, or a DM correcting a class's description
        // would get a class with no levels and no features.
        copyOnWrite(e, override);
      }
      apply(req, override);
      override.setOwnerId(userId);
      override.setOverridesId(id);
      // The override is still that edition's content, so it follows the base
      // row when a reader filters editions. apply() can't set this — the
      // request DTOs carry no SRD version, deliberately: a DM edits rules text,
      // not which book the rules came from.
      override.setSrdVersion(e.getSrdVersion());
      return toResponse(repo().save(override));
    }
    if (!userId.equals(e.getOwnerId())) {
      throw forbidden();
    }
    apply(req, e);
    return toResponse(repo().save(e));
  }

  /**
   * A hook for content whose deletion Hibernate can't work out on its own. Most
   * types need nothing here; a stat block does, because its features refer to
   * each other and the order those come apart in matters.
   */
  protected void beforeDelete(E entity) {}

  /**
   * Seed a fresh override from the row it shadows, for the parts the request
   * doesn't carry. Most types need nothing: their request is the whole row.
   */
  protected void copyOnWrite(E base, E override) {}

  @Transactional
  public RES revert(UUID baseId, UUID userId) {
    repo()
        .findByOwnerIdAndOverridesId(userId, baseId)
        .ifPresent(
            override -> {
              beforeDelete(override);
              repo().delete(override);
            });
    E base =
        repo().findById(baseId).filter(CatalogContent::isBaseContent).orElseThrow(AbstractCatalogService::notFound);
    return toResponse(base);
  }

  @Transactional
  public void delete(UUID id, UUID userId) {
    E e = repo().findById(id).orElseThrow(AbstractCatalogService::notFound);
    if (e.isBaseContent() || !userId.equals(e.getOwnerId())) {
      throw forbidden();
    }
    beforeDelete(e);
    repo().delete(e);
  }

  @Transactional
  public void hide(UUID baseId, UUID userId) {
    repo().findById(baseId).filter(CatalogContent::isBaseContent).orElseThrow(AbstractCatalogService::notFound);
    if (!hiddenRepo().existsByOwnerIdAndContentTypeAndBaseId(userId, contentType(), baseId)) {
      HiddenContent h = new HiddenContent();
      h.setOwnerId(userId);
      h.setContentType(contentType());
      h.setBaseId(baseId);
      hiddenRepo().save(h);
    }
  }

  @Transactional
  public void unhide(UUID baseId, UUID userId) {
    hiddenRepo().deleteByOwnerIdAndContentTypeAndBaseId(userId, contentType(), baseId);
  }

  /** A row is readable if it's base content or owned by the caller. */
  protected E readable(UUID id, UUID userId) {
    E e = repo().findById(id).orElseThrow(AbstractCatalogService::notFound);
    if (e.isBaseContent() || (userId != null && userId.equals(e.getOwnerId()))) {
      return e;
    }
    throw notFound();
  }

  protected static ResponseStatusException notFound() {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "Not found");
  }

  protected static ResponseStatusException forbidden() {
    return new ResponseStatusException(HttpStatus.FORBIDDEN, "That content isn't yours to change");
  }
}
