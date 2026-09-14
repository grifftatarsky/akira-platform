package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.SrdVersion;
import com.gpt.oozengine.model.Condition;
import com.gpt.oozengine.model.dto.request.ConditionRequest;
import com.gpt.oozengine.model.dto.response.ConditionResponse;
import com.gpt.oozengine.repository.ConditionRepository;
import com.gpt.oozengine.service.ConditionService;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/**
 * The SRD version rules that aren't visible in a single class: what the seed
 * data ends up carrying, and where an override gets its version from.
 *
 * <p>Exercised through {@link ConditionService} because Condition is the
 * simplest catalog type, but the behaviour lives in {@code
 * AbstractCatalogService} and so is shared by all ten of them. The service is
 * called directly rather than over HTTP — the authority checks are on the
 * controller, and it's the ownership logic under test here, not the security.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class SrdVersionTests {

  @Autowired private ConditionService conditions;
  @Autowired private ConditionRepository repo;

  @Test
  @DisplayName("every seeded base row is tagged with the SRD it came from")
  void seededContentIsTagged() {
    var base = repo.findByOwnerIdIsNull();
    assertThat(base).isNotEmpty();
    assertThat(base).allSatisfy(c -> assertThat(c.getSrdVersion()).isEqualTo(SrdVersion.SRD_5_2));
  }

  @Test
  @DisplayName("an override inherits the base row's SRD version")
  void overrideInheritsVersion() {
    UUID user = UUID.randomUUID();
    Condition base = repo.findByOwnerIdIsNull().getFirst();

    ConditionResponse override =
        conditions.update(base.getId(), new ConditionRequest(base.getName(), base.getCode(), "my table's ruling"), user);

    // Without the inheritance the override would come back null and go on
    // showing after a reader switched that edition off.
    assertThat(override.srdVersion()).isEqualTo(base.getSrdVersion());
    assertThat(override.base()).isFalse();
    assertThat(override.overridesId()).isEqualTo(base.getId());

    conditions.revert(base.getId(), user);
  }

  @Test
  @DisplayName("a DM's own creation has no SRD version")
  void createdContentHasNoVersion() {
    UUID user = UUID.randomUUID();
    ConditionResponse created =
        conditions.create(new ConditionRequest("Bewildered", null, "Homebrew condition."), user);

    assertThat(created.srdVersion()).isNull();

    conditions.delete(created.id(), user);
  }
}
