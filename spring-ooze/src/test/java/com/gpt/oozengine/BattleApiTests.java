package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The tracker over HTTP, and the one seam where it meets the board.
 *
 * <p>Every battle here is seeded, so an assertion about who goes first is a fact
 * about this test rather than something that usually happens.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class BattleApiTests {

  @Autowired private MockMvc mvc;
  @Autowired private EntityManager em;
  private final ObjectMapper json = new ObjectMapper();

  private final UUID dm = UUID.randomUUID();

  private MockHttpServletRequestBuilder as(UUID user, MockHttpServletRequestBuilder req) {
    return req.with(jwt()
            .jwt(j -> j.subject(user.toString()))
            .authorities(new SimpleGrantedAuthority("MANAGE_CONTENT")))
        .with(csrf())
        .contentType(MediaType.APPLICATION_JSON);
  }

  private JsonNode postJson(UUID user, MockHttpServletRequestBuilder req, String body)
      throws Exception {
    var call = as(user, req);
    if (body != null) {
      call = call.content(body);
    }
    String out = mvc.perform(call)
        .andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString();
    return json.readTree(out);
  }

  private UUID statBlockId(String monster) {
    return em.createQuery(
            "select m.statBlock.id from Monster m where m.ownerId is null and m.name = :n",
            UUID.class)
        .setParameter("n", monster).getSingleResult();
  }

  private JsonNode newBattle() throws Exception {
    return postJson(dm, post("/battle"), """
        {"name": "Ambush at the ford", "seed": 4242}
        """);
  }

  @Test
  @DisplayName("A DM runs a fight with nothing but names and hit points")
  void trackerWorksAlone() throws Exception {
    var b = newBattle();
    String id = b.get("id").asText();

    // No encounter, no board, no compendium — which is the claim that makes
    // this shippable on its own.
    postJson(dm, post("/battle/{id}/participant", id), """
        {"name": "Bandit", "maxHitPoints": 11, "initiativeBonus": 2}
        """);
    postJson(dm, post("/battle/{id}/participant", id), """
        {"name": "Thalia", "maxHitPoints": 31, "initiativeBonus": 3}
        """);

    mvc.perform(as(dm, post("/battle/{id}/initiative", id)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.round").value(1))
        .andExpect(jsonPath("$.phase").value("IN_TURN"))
        .andExpect(jsonPath("$.order.length()").value(2))
        .andExpect(jsonPath("$.currentParticipantId").exists())
        .andExpect(jsonPath("$.encounterId").doesNotExist());
  }

  @Test
  @DisplayName("Crossing a turn boundary takes two steps, and the pause is visible")
  void thePauseIsOnTheWire() throws Exception {
    var b = newBattle();
    String id = b.get("id").asText();
    postJson(dm, post("/battle/{id}/participant", id),
        "{\"name\": \"Bandit\", \"maxHitPoints\": 11}");
    postJson(dm, post("/battle/{id}/participant", id),
        "{\"name\": \"Thalia\", \"maxHitPoints\": 31}");
    postJson(dm, post("/battle/{id}/initiative", id), null);

    // Between turns the client has no highlighted row and a place to put a
    // reaction — which is why currentParticipantId goes away rather than
    // lingering on whoever just finished.
    mvc.perform(as(dm, post("/battle/{id}/advance", id)))
        .andExpect(jsonPath("$.phase").value("BETWEEN_TURNS"))
        .andExpect(jsonPath("$.currentParticipantId").doesNotExist());
    mvc.perform(as(dm, post("/battle/{id}/advance", id)))
        .andExpect(jsonPath("$.phase").value("IN_TURN"))
        .andExpect(jsonPath("$.currentParticipantId").exists());
  }

  @Test
  @DisplayName("Damage, conditions and a note all land in the log")
  void bookkeepingIsLogged() throws Exception {
    var b = newBattle();
    String id = b.get("id").asText();
    var added = postJson(dm, post("/battle/{id}/participant", id),
        "{\"name\": \"Thalia\", \"maxHitPoints\": 31}");
    String p = added.get("order").get(0).get("id").asText();
    postJson(dm, post("/battle/{id}/initiative", id), null);

    mvc.perform(as(dm, post("/battle/{id}/participant/{p}/hit-points", id, p))
            .content("{\"delta\": -14, \"reason\": \"Rend\"}"))
        .andExpect(jsonPath("$.currentHitPoints").value(17))
        .andExpect(jsonPath("$.bloodied").value(false));

    mvc.perform(as(dm, post("/battle/{id}/participant/{p}/condition/{c}", id, p, "Prone")))
        .andExpect(jsonPath("$.conditions[0]").value("Prone"));

    var after = postJson(dm, post("/battle/{id}/note", id).param("participantId", p),
        "The sprite knows her alignment");
    assertThat(after.get("log").toString()).contains("knows her alignment");
  }

  @Test
  @DisplayName("Rewinding by sequence puts the fight back")
  void rewindOverHttp() throws Exception {
    var b = newBattle();
    String id = b.get("id").asText();
    var added = postJson(dm, post("/battle/{id}/participant", id),
        "{\"name\": \"Thalia\", \"maxHitPoints\": 31}");
    String p = added.get("order").get(0).get("id").asText();
    var started = postJson(dm, post("/battle/{id}/initiative", id), null);
    long mark = started.get("log").get(started.get("log").size() - 1).get("sequence").asLong();

    mvc.perform(as(dm, post("/battle/{id}/participant/{p}/hit-points", id, p))
            .content("{\"delta\": -20, \"reason\": \"Rend\"}"))
        .andExpect(jsonPath("$.currentHitPoints").value(11));

    // Addressed by a sequence the client read off the log — which is why every
    // line carries one.
    mvc.perform(as(dm, post("/battle/{id}/rewind/{seq}", id, mark)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.order[0].currentHitPoints").value(31))
        .andExpect(jsonPath("$.phase").value("IN_TURN"));
  }

  @Test
  @DisplayName("An encounter lifts into a battle, and the board is left alone")
  void launchFromAnEncounter() throws Exception {
    var e = postJson(dm, post("/encounter"), "{\"name\": \"The ford\"}");
    String encounterId = e.get("id").asText();
    postJson(dm, post("/encounter/{id}/combatant", encounterId), """
        {"statBlockId": "%s", "name": "Owlbear", "xHalfFeet": 20, "yHalfFeet": 20}
        """.formatted(statBlockId("Owlbear")));
    postJson(dm, post("/encounter/{id}/combatant", encounterId), """
        {"statBlockId": "%s", "name": "Lurker", "xHalfFeet": 80, "yHalfFeet": 20,
         "disposition": "ON_DECK", "surprised": true}
        """.formatted(statBlockId("Goblin Warrior")));

    var battle = postJson(dm, post("/encounter/{id}/battle", encounterId),
        "{\"name\": \"The ford, round one\", \"seed\": 7}");

    assertThat(battle.get("encounterId").asText()).isEqualTo(encounterId);
    // The on-deck creature is carried across as on-deck, not quietly recruited,
    // and it keeps the surprise it was placed with.
    assertThat(battle.get("order")).hasSize(1);
    assertThat(battle.get("onDeck")).hasSize(1);
    assertThat(battle.get("onDeck").get(0).get("surprised").asBoolean()).isTrue();
    // The Owlbear's hit points come from the book rather than a roll, so the
    // same encounter opens the same way every time.
    assertThat(battle.get("order").get(0).get("maxHitPoints").asInt()).isEqualTo(59);

    // Running the fight must not scar the board it came from.
    mvc.perform(as(dm, get("/encounter/{id}", encounterId)))
        .andExpect(jsonPath("$.combatants.length()").value(2));
  }

  @Test
  @DisplayName("The lifted on-deck creature can still be walked in mid-fight")
  void promoteOverHttp() throws Exception {
    var e = postJson(dm, post("/encounter"), "{\"name\": \"Balcony\"}");
    String encounterId = e.get("id").asText();
    postJson(dm, post("/encounter/{id}/combatant", encounterId), """
        {"statBlockId": "%s", "name": "Owlbear", "xHalfFeet": 20, "yHalfFeet": 20}
        """.formatted(statBlockId("Owlbear")));
    postJson(dm, post("/encounter/{id}/combatant", encounterId), """
        {"statBlockId": "%s", "name": "Lurker", "xHalfFeet": 80, "yHalfFeet": 20,
         "disposition": "ON_DECK"}
        """.formatted(statBlockId("Goblin Warrior")));
    var battle = postJson(dm, post("/encounter/{id}/battle", encounterId), null);
    String id = battle.get("id").asText();
    postJson(dm, post("/battle/{id}/initiative", id), null);
    String lurker = battle.get("onDeck").get(0).get("id").asText();

    mvc.perform(as(dm, post("/battle/{id}/participant/{p}/promote", id, lurker)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.order.length()").value(2))
        .andExpect(jsonPath("$.onDeck.length()").value(0));
  }

  @Test
  @DisplayName("Another DM's battle is a 404")
  void strangersGetNotFound() throws Exception {
    var b = newBattle();

    mvc.perform(as(UUID.randomUUID(), get("/battle/{id}", b.get("id").asText())))
        .andExpect(status().isNotFound());
  }

  @Test
  @DisplayName("Battles need the role, like everything else in the tool")
  void playersAreShutOut() throws Exception {
    mvc.perform(get("/battle").with(jwt().jwt(j -> j.subject(dm.toString()))))
        .andExpect(status().isForbidden());
  }
}
