package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The tracker must not learn about the board.
 *
 * <p>Phase 3 ships on its own as an initiative tracker, and "ships on its own"
 * is only true while nothing in it reaches for a map. That is an easy thing to
 * break by accident and an invisible one — the code still compiles, the tests
 * still pass, and the claim quietly stops being true — so it is asserted rather
 * than intended.
 *
 * <p>Checked by reading imports rather than with a module framework: this is one
 * rule about two packages, and a dependency to enforce it would be a heavier
 * thing than the rule.
 */
class TrackerBoundaryTests {

  private static final Path SOURCE = Path.of("src/main/java/com/gpt/oozengine");

  /** Everything that is the tracker, and nothing that is the simulator. */
  private static final List<Path> TRACKER = List.of(
      SOURCE.resolve("model/battle"),
      SOURCE.resolve("service/BattleService.java"),
      SOURCE.resolve("service/BattleFold.java"),
      SOURCE.resolve("repository/BattleRepository.java"));

  /** Names that mean the board, in the order they would show up in an import. */
  private static final List<String> BOARD = List.of(
      "model.encounter", "util.Geometry", "service.Battlefield", "service.EncounterService",
      "service.Painter", "util.Falling");

  private static Stream<Path> javaFiles(Path root) throws IOException {
    if (Files.isRegularFile(root)) {
      return Stream.of(root);
    }
    try (var walk = Files.walk(root)) {
      return walk.filter(p -> p.toString().endsWith(".java")).toList().stream();
    }
  }

  @Test
  @DisplayName("Nothing in the tracker imports the board")
  void trackerDoesNotKnowAboutTheMap() throws IOException {
    for (Path root : TRACKER) {
      assertThat(root).exists();
      for (Path file : javaFiles(root).toList()) {
        String source = Files.readString(file);
        List<String> imports = source.lines()
            .filter(l -> l.startsWith("import "))
            .toList();
        for (String forbidden : BOARD) {
          assertThat(imports)
              .as("%s must not reach for %s — the tracker ships without a board",
                  file.getFileName(), forbidden)
              .noneMatch(line -> line.contains(forbidden));
        }
      }
    }
  }

  @Test
  @DisplayName("A battle is startable with no encounter behind it")
  void encounterLinkIsOptional() throws IOException {
    String battle = Files.readString(SOURCE.resolve("model/battle/Battle.java"));

    // encounterId is a bare UUID column, not a mapping: a real association would
    // make an encounter a thing a battle must have, which is the dependency this
    // whole boundary exists to avoid.
    assertThat(battle).contains("private UUID encounterId");
    assertThat(battle).doesNotContain("@ManyToOne");
    assertThat(battle).doesNotContain("@JoinColumn(name = \"encounter_id\"");
  }
}
