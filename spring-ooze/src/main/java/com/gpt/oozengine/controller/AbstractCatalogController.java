package com.gpt.oozengine.controller;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.model.dto.request.CatalogFilter;
import com.gpt.oozengine.service.AbstractCatalogService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.data.web.PagedModel;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * Shared REST surface for catalog content. Concrete controllers add
 * {@code @RestController} + {@code @RequestMapping("<path>")} and supply the
 * service; Spring resolves the generic {@code REQ} body type and inherits these
 * mappings from the subclass. Reads are public (permit-all in config); writes
 * require {@code MANAGE_CONTENT} and only touch the caller's own content.
 */
public abstract class AbstractCatalogController<REQ, RES> {

  protected abstract AbstractCatalogService<?, REQ, RES> service();

  /**
   * A page of the catalog.
   *
   * <p>Returned as {@link PagedModel} rather than {@code Page}: Spring Data's
   * own advice, because {@code PageImpl}'s JSON is an implementation detail that
   * has changed between releases, while PagedModel's {@code page} envelope is a
   * contract. Sorting is left to each service's default unless {@code ?sort=}
   * asks for something else.
   *
   * @param query case-insensitive name fragment
   * @param includeLegacy whether to include SRD 5.1 rows (the finder's toggle)
   */
  @GetMapping
  public PagedModel<RES> list(
      @RequestParam(required = false) String query,
      @RequestParam(defaultValue = "true") boolean includeLegacy,
      @PageableDefault(size = 50) Pageable pageable,
      @AuthenticationPrincipal Jwt jwt) {
    CatalogFilter filter = new CatalogFilter(query, includeLegacy);
    return new PagedModel<>(service().page(userId(jwt), filter, pageable));
  }

  /**
   * Which SRD editions this catalog holds. The finder asks so it knows whether
   * to offer the edition toggle; it can't tell from a page, because a page with
   * the toggle already off contains no evidence that it should be there.
   */
  @GetMapping("/editions")
  public List<SrdVersion> editions() {
    return service().editions();
  }

  @GetMapping("/{id}")
  public RES get(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    return service().get(id, userId(jwt));
  }

  @PostMapping
  @PreAuthorize("hasAuthority('MANAGE_CONTENT')")
  public ResponseEntity<RES> create(@Valid @RequestBody REQ req, @AuthenticationPrincipal Jwt jwt) {
    return ResponseEntity.ok(service().create(req, requireUserId(jwt)));
  }

  @PutMapping("/{id}")
  @PreAuthorize("hasAuthority('MANAGE_CONTENT')")
  public RES update(
      @PathVariable UUID id, @Valid @RequestBody REQ req, @AuthenticationPrincipal Jwt jwt) {
    return service().update(id, req, requireUserId(jwt));
  }

  @DeleteMapping("/{id}")
  @PreAuthorize("hasAuthority('MANAGE_CONTENT')")
  public ResponseEntity<Void> delete(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    service().delete(id, requireUserId(jwt));
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/{id}/revert")
  @PreAuthorize("hasAuthority('MANAGE_CONTENT')")
  public RES revert(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    return service().revert(id, requireUserId(jwt));
  }

  @PostMapping("/{id}/hide")
  @PreAuthorize("hasAuthority('MANAGE_CONTENT')")
  public ResponseEntity<Void> hide(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    service().hide(id, requireUserId(jwt));
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/{id}/hide")
  @PreAuthorize("hasAuthority('MANAGE_CONTENT')")
  public ResponseEntity<Void> unhide(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    service().unhide(id, requireUserId(jwt));
    return ResponseEntity.noContent().build();
  }

  protected static UUID userId(Jwt jwt) {
    return jwt == null ? null : UUID.fromString(jwt.getSubject());
  }

  protected static UUID requireUserId(Jwt jwt) {
    return UUID.fromString(jwt.getSubject());
  }
}
