package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.model.Condition;
import com.gpt.oozengine.model.dto.request.CatalogFilter;
import com.gpt.oozengine.model.dto.request.ConditionRequest;
import com.gpt.oozengine.model.dto.response.ConditionResponse;
import com.gpt.oozengine.model.dto.response.MonsterResponse;
import com.gpt.oozengine.repository.ConditionRepository;
import com.gpt.oozengine.service.ConditionService;
import com.gpt.oozengine.service.MonsterService;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Paging, searching and filtering the catalog.
 *
 * <p>The visibility rules — your override replaces the base row it shadows, a
 * row you hid disappears, your own creations join the list — used to be applied
 * in memory after loading the whole table. Moving them into SQL is the kind of
 * change that quietly loses one of them, so each is asserted here against a
 * page rather than against a list.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class CatalogPagingTests {

  @Autowired private MockMvc mvc;
  @Autowired private MonsterService monsters;
  @Autowired private ConditionService conditions;
  @Autowired private ConditionRepository conditionRepo;

  @Test
  @DisplayName("the bestiary comes back a page at a time, in name order")
  void bestiaryPages() {
    Page<MonsterResponse> first = monsters.page(null, CatalogFilter.all(), PageRequest.of(0, 25));

    assertThat(first.getContent()).hasSize(25);
    assertThat(first.getTotalElements()).isGreaterThan(300);
    assertThat(first.getContent())
        .extracting(MonsterResponse::name)
        .isSortedAccordingTo(String.CASE_INSENSITIVE_ORDER);
  }

  @Test
  @DisplayName("consecutive pages don't repeat rows")
  void pagesDoNotOverlap() {
    List<UUID> first =
        monsters.page(null, CatalogFilter.all(), PageRequest.of(0, 40)).map(MonsterResponse::id)
            .getContent();
    List<UUID> second =
        monsters.page(null, CatalogFilter.all(), PageRequest.of(1, 40)).map(MonsterResponse::id)
            .getContent();

    // Without a deterministic sort Postgres is free to return rows in any order
    // per query, so page 2 can hand back rows page 1 already showed.
    assertThat(first).doesNotContainAnyElementsOf(second);
  }

  @Test
  @DisplayName("the name search runs in the database, not over a loaded list")
  void searchesByName() {
    Page<MonsterResponse> all = monsters.page(null, CatalogFilter.all(), PageRequest.of(0, 1));
    Page<MonsterResponse> hit =
        monsters.page(null, new CatalogFilter("dragon", true), PageRequest.of(0, 200));

    assertThat(hit.getTotalElements()).isLessThan(all.getTotalElements());
    assertThat(hit.getContent())
        .isNotEmpty()
        .allSatisfy(m -> assertThat(m.name().toLowerCase()).contains("dragon"));
  }

  @Test
  @DisplayName("a caller's sort beats the type's default")
  void explicitSortWins() {
    Page<MonsterResponse> page =
        monsters.page(
            null, CatalogFilter.all(), PageRequest.of(0, 10, Sort.by(Sort.Direction.DESC, "name")));

    assertThat(page.getContent())
        .extracting(MonsterResponse::name)
        .isSortedAccordingTo(String.CASE_INSENSITIVE_ORDER.reversed());
  }

  @Test
  @DisplayName("an override replaces its base row in the page, and hiding removes one")
  void overridesAndHidesSurviveThePage() {
    UUID user = UUID.randomUUID();
    long total = conditions.page(user, CatalogFilter.all(), PageRequest.of(0, 1)).getTotalElements();
    Condition base = conditionRepo.findByOwnerIdIsNull().getFirst();

    ConditionResponse override =
        conditions.update(
            base.getId(),
            new ConditionRequest(base.getName(), base.getCode(), "my table's ruling"),
            user);
    try {
      List<ConditionResponse> mine =
          conditions.page(user, CatalogFilter.all(), PageRequest.of(0, 200)).getContent();

      assertThat(mine).hasSize((int) total);
      assertThat(mine).extracting(ConditionResponse::id).contains(override.id());
      assertThat(mine).extracting(ConditionResponse::id).doesNotContain(base.getId());

      // Someone else still sees the original.
      assertThat(conditions.page(UUID.randomUUID(), CatalogFilter.all(), PageRequest.of(0, 200)))
          .extracting(ConditionResponse::id)
          .contains(base.getId())
          .doesNotContain(override.id());
    } finally {
      conditions.revert(base.getId(), user);
    }

    Condition other = conditionRepo.findByOwnerIdIsNull().get(1);
    conditions.hide(other.getId(), user);
    try {
      Page<ConditionResponse> afterHide =
          conditions.page(user, CatalogFilter.all(), PageRequest.of(0, 200));
      assertThat(afterHide.getTotalElements()).isEqualTo(total - 1);
      assertThat(afterHide.getContent())
          .extracting(ConditionResponse::id)
          .doesNotContain(other.getId());
    } finally {
      conditions.unhide(other.getId(), user);
    }
  }

  @Test
  @DisplayName("the REST envelope carries the page metadata the finder reads")
  void restReturnsPagedModel() throws Exception {
    // The finder's "Showing 25 of 330" and its Load more button both come from
    // this envelope, so its field names are a contract, not an artefact.
    mvc.perform(get("/monster").param("page", "1").param("size", "25"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content.length()").value(25))
        .andExpect(jsonPath("$.page.number").value(1))
        .andExpect(jsonPath("$.page.size").value(25))
        .andExpect(jsonPath("$.page.totalElements").isNumber())
        .andExpect(jsonPath("$.page.totalPages").isNumber())
        // The list row is a summary; the stat block is fetched per creature.
        .andExpect(jsonPath("$.content[0].name").isString());
  }

  @Test
  @DisplayName("the size cap keeps one request from pulling the whole catalog")
  void sizeIsCapped() throws Exception {
    mvc.perform(get("/monster").param("size", "5000"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.page.size").value(200));
  }

  @Test
  @DisplayName("the legacy toggle drops SRD 5.1 rows but never a DM's own")
  void legacyToggleSpares() {
    Condition legacy = new Condition();
    legacy.setName("zzz-paging-test-legacy");
    legacy.setDescription("Only in the older book.");
    legacy.setSrdVersion(SrdVersion.SRD_5_1);
    conditionRepo.save(legacy);

    UUID user = UUID.randomUUID();
    ConditionResponse homebrew =
        conditions.create(new ConditionRequest("zzz-paging-test-homebrew", null, "A ruling of my own."), user);
    try {
      List<UUID> shown =
          conditions.page(user, new CatalogFilter(null, false), PageRequest.of(0, 200)).getContent()
              .stream()
              .map(ConditionResponse::id)
              .toList();

      assertThat(shown).doesNotContain(legacy.getId());
      // Homebrew has no SRD version at all; an edition toggle must not eat it.
      assertThat(shown).contains(homebrew.id());
      assertThat(conditions.page(user, CatalogFilter.all(), PageRequest.of(0, 200)))
          .extracting(ConditionResponse::id)
          .contains(legacy.getId());
    } finally {
      conditions.delete(homebrew.id(), user);
      conditionRepo.delete(legacy);
    }
  }
}
