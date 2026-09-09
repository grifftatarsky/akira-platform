package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
 * The encounter API over HTTP.
 *
 * <p>Driven through MockMvc rather than the service, because the claims here are
 * about the wire: that a stranger gets 404 and not 403, that a refused placement
 * is a client error rather than a 500, and that the board a client draws from
 * the response matches the one the server will adjudicate.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class EncounterApiTests {

  @Autowired private MockMvc mvc;
  // Constructed rather than injected: this module configures web JSON through
  // the starter without exposing an ObjectMapper bean to inject.
  private final ObjectMapper json = new ObjectMapper();
  @Autowired private EntityManager em;

  private final UUID dm = UUID.randomUUID();
  private final UUID otherDm = UUID.randomUUID();

  private MockHttpServletRequestBuilder as(UUID user, MockHttpServletRequestBuilder req) {
    return req.with(jwt()
            .jwt(j -> j.subject(user.toString()))
            .authorities(new SimpleGrantedAuthority("MANAGE_CONTENT")))
        .with(csrf())
        .contentType(MediaType.APPLICATION_JSON);
  }

  private UUID statBlockId(String monster) {
    return em.createQuery(
            "select m.statBlock.id from Monster m where m.ownerId is null and m.name = :n",
            UUID.class)
        .setParameter("n", monster)
        .getSingleResult();
  }

  private JsonNode createEncounter(UUID owner, String body) throws Exception {
    String out = mvc.perform(as(owner, post("/encounter")).content(body))
        .andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString();
    return json.readTree(out);
  }

  @Test
  @DisplayName("A new encounter comes back with a default board, unasked")
  void createsWithADefaultBoard() throws Exception {
    var e = createEncounter(dm, """
        {"name": "Ambush at the ford"}
        """);

    // A DM who wants to drop monsters somewhere and think about terrain later
    // should not have to describe a board first.
    assertBoard(e, 20, 20, 5);
    assertThat(e.get("combatants")).isEmpty();
  }

  @Test
  @DisplayName("Painting the board stores only the squares that differ")
  void paintingIsSparse() throws Exception {
    var e = createEncounter(dm, """
        {"name": "The bridge",
         "map": {"width": 10, "height": 10, "cellFeet": 5,
                 "cells": [{"x": 3, "y": 3, "terrain": "WALL"},
                           {"x": 4, "y": 4, "elevationFeet": 10},
                           {"x": 5, "y": 5}]}}
        """);

    // Three sent, two stored: the third names no override at all, and sparse
    // storage exists precisely so that square has no row.
    assertThat(e.get("map").get("cells")).hasSize(2);
  }

  @Test
  @DisplayName("A cell off the edge of the map is rejected, not silently kept")
  void offBoardCellsAreRejected() throws Exception {
    mvc.perform(as(dm, post("/encounter")).content("""
            {"name": "Too small",
             "map": {"width": 5, "height": 5, "cellFeet": 5,
                     "cells": [{"x": 9, "y": 0, "terrain": "WALL"}]}}
            """))
        .andExpect(status().isBadRequest());
  }

  @Test
  @DisplayName("A board wider than the cap is refused by validation")
  void boardBoundsAreValidated() throws Exception {
    mvc.perform(as(dm, post("/encounter")).content("""
            {"name": "Enormous",
             "map": {"width": 500, "height": 500, "cellFeet": 5, "cells": []}}
            """))
        .andExpect(status().isBadRequest());
  }

  @Test
  @DisplayName("Placing a token returns its footprint and what it is allowed to do")
  void placementReturnsTheFootprint() throws Exception {
    var e = createEncounter(dm, "{\"name\": \"Woods\"}");
    String id = e.get("id").asText();

    mvc.perform(as(dm, post("/encounter/{id}/combatant", id)).content("""
            {"statBlockId": "%s", "name": "Owlbear", "xHalfFeet": 20, "yHalfFeet": 20}
            """.formatted(statBlockId("Owlbear"))))
        .andExpect(status().isOk())
        // The client draws the board, so it gets the resolved footprint rather
        // than working it out from a rule the server might not share.
        .andExpect(jsonPath("$.size").value("LARGE"))
        .andExpect(jsonPath("$.spaceHalfFeet").value(20))
        .andExpect(jsonPath("$.disposition").value("ACTIVE"));
  }

  @Test
  @DisplayName("A swarm's licence to share a square travels with it")
  void capabilitiesAreOnTheWire() throws Exception {
    var e = createEncounter(dm, "{\"name\": \"Cellar\"}");
    String id = e.get("id").asText();

    mvc.perform(as(dm, post("/encounter/{id}/combatant", id)).content("""
            {"statBlockId": "%s", "xHalfFeet": 20, "yHalfFeet": 20}
            """.formatted(statBlockId("Swarm of Rats"))))
        .andExpect(status().isOk())
        // The board needs this before the DM drags something onto the swarm,
        // not after the server refuses.
        .andExpect(jsonPath("$.capabilities").value(
            hasItem("OCCUPY_CREATURE_SPACE")));
  }

  @Test
  @DisplayName("Stacking two tokens is a client error, not a server fault")
  void overlapIsAClientError() throws Exception {
    var e = createEncounter(dm, "{\"name\": \"Crowded\"}");
    String id = e.get("id").asText();
    String owlbear = """
        {"statBlockId": "%s", "xHalfFeet": 20, "yHalfFeet": 20}
        """.formatted(statBlockId("Owlbear"));

    mvc.perform(as(dm, post("/encounter/{id}/combatant", id)).content(owlbear))
        .andExpect(status().isOk());
    // A conflict, not a bad request: the body was fine, the board disagreed.
    mvc.perform(as(dm, post("/encounter/{id}/combatant", id)).content(owlbear))
        .andExpect(status().isConflict());
  }

  @Test
  @DisplayName("Another DM's encounter is a 404, so the id does not leak")
  void strangersGetNotFound() throws Exception {
    var e = createEncounter(dm, "{\"name\": \"Private\"}");
    String id = e.get("id").asText();

    // 404 rather than 403: a stranger should not learn the encounter exists.
    mvc.perform(as(otherDm, get("/encounter/{id}", id)))
        .andExpect(status().isNotFound());
  }

  @Test
  @DisplayName("A DM without the role cannot reach encounters at all")
  void playersAreShutOut() throws Exception {
    // Every route is gated, reads included: an encounter is a plan for a
    // session and the players are not supposed to see it.
    mvc.perform(get("/encounter").with(jwt().jwt(j -> j.subject(dm.toString()))))
        .andExpect(status().isForbidden());
  }

  @Test
  @DisplayName("The list gives summaries, not whole boards")
  void listIsSummaries() throws Exception {
    createEncounter(dm, """
        {"name": "One", "map": {"width": 8, "height": 9, "cellFeet": 5,
         "cells": [{"x": 1, "y": 1, "terrain": "WALL"}]}}
        """);

    mvc.perform(as(dm, get("/encounter")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content[0].width").value(8))
        .andExpect(jsonPath("$.content[0].height").value(9))
        .andExpect(jsonPath("$.content[0].combatantCount").value(0))
        // A page of forty full boards to render a list of names is a lot of
        // board nobody is looking at.
        .andExpect(jsonPath("$.content[0].map").doesNotExist());
  }

  @Test
  @DisplayName("Repainting replaces the canvas rather than patching it")
  void repaintingReplaces() throws Exception {
    var e = createEncounter(dm, """
        {"name": "Cave", "map": {"width": 10, "height": 10, "cellFeet": 5,
         "cells": [{"x": 1, "y": 1, "terrain": "WALL"},
                   {"x": 2, "y": 2, "terrain": "WALL"}]}}
        """);
    String id = e.get("id").asText();

    // A DM who erases a wall sends a list without it, and a merge would have no
    // way to tell that from a list that simply did not mention it.
    mvc.perform(as(dm, put("/encounter/{id}", id)).content("""
            {"name": "Cave", "map": {"width": 10, "height": 10, "cellFeet": 5,
             "cells": [{"x": 1, "y": 1, "terrain": "WALL"}]}}
            """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.map.cells.length()").value(1));
  }

  @Test
  @DisplayName("A token can be moved, and removed")
  void moveAndRemove() throws Exception {
    var e = createEncounter(dm, "{\"name\": \"Field\"}");
    String id = e.get("id").asText();
    String placed = mvc.perform(as(dm, post("/encounter/{id}/combatant", id)).content("""
            {"statBlockId": "%s", "xHalfFeet": 20, "yHalfFeet": 20}
            """.formatted(statBlockId("Owlbear"))))
        .andReturn().getResponse().getContentAsString();
    String combatantId = json.readTree(placed).get("id").asText();

    mvc.perform(as(dm, put("/encounter/{id}/combatant/{c}", id, combatantId)).content("""
            {"statBlockId": "%s", "xHalfFeet": 120, "yHalfFeet": 60, "zHalfFeet": 20}
            """.formatted(statBlockId("Owlbear"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.xHalfFeet").value(120))
        // Elevation is the same field whether it is flying or on a balcony.
        .andExpect(jsonPath("$.zHalfFeet").value(20));

    mvc.perform(as(dm, delete("/encounter/{id}/combatant/{c}", id, combatantId)))
        .andExpect(status().isNoContent());
    mvc.perform(as(dm, get("/encounter/{id}", id)))
        .andExpect(jsonPath("$.combatants.length()").value(0));
  }

  @Test
  @DisplayName("A room is outlined in one stroke, not two hundred requests")
  void paintingAnOutline() throws Exception {
    var e = createEncounter(dm, """
        {"name": "The vault", "map": {"width": 20, "height": 20, "cellFeet": 5, "cells": []}}
        """);
    String id = e.get("id").asText();

    mvc.perform(as(dm, post("/encounter/{id}/map/paint", id)).content("""
            [{"shape": "OUTLINE", "x1": 2, "y1": 2, "x2": 9, "y2": 9,
              "brush": {"x": 0, "y": 0, "terrain": "WALL"}}]
            """))
        .andExpect(status().isOk())
        // The ring of an 8x8 is 28 squares. Painting that one request at a time
        // is what makes a hand-built board unusable.
        .andExpect(jsonPath("$.map.cells.length()").value(28));
  }

  @Test
  @DisplayName("Strokes apply in order, so a doorway can be cut after the wall")
  void strokesApplyInOrder() throws Exception {
    var e = createEncounter(dm, """
        {"name": "The cell", "map": {"width": 20, "height": 20, "cellFeet": 5, "cells": []}}
        """);
    String id = e.get("id").asText();

    mvc.perform(as(dm, post("/encounter/{id}/map/paint", id)).content("""
            [{"shape": "OUTLINE", "x1": 0, "y1": 0, "x2": 5, "y2": 5,
              "brush": {"x": 0, "y": 0, "terrain": "WALL"}},
             {"shape": "RECTANGLE", "x1": 0, "y1": 2, "x2": 0, "y2": 3, "erase": true}]
            """))
        .andExpect(status().isOk())
        // 20 in the ring, less the two erased for the door.
        .andExpect(jsonPath("$.map.cells.length()").value(18));
  }

  @Test
  @DisplayName("A brush leaves alone what it does not mention")
  void brushesArePartial() throws Exception {
    var e = createEncounter(dm, """
        {"name": "The ledge", "map": {"width": 20, "height": 20, "cellFeet": 5, "cells": []}}
        """);
    String id = e.get("id").asText();

    mvc.perform(as(dm, post("/encounter/{id}/map/paint", id)).content("""
            [{"shape": "RECTANGLE", "x1": 1, "y1": 1, "x2": 2, "y2": 2,
              "brush": {"x": 0, "y": 0, "terrain": "RUBBLE"}},
             {"shape": "RECTANGLE", "x1": 1, "y1": 1, "x2": 2, "y2": 2,
              "brush": {"x": 0, "y": 0, "elevationFeet": 10}}]
            """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.map.cells.length()").value(4))
        // Raising the ground across a room must not repaint its terrain.
        .andExpect(jsonPath("$.map.cells[0].terrain").value("RUBBLE"))
        .andExpect(jsonPath("$.map.cells[0].elevationFeet").value(10));
  }

  @Test
  @DisplayName("Erasing shrinks the board rather than storing empty squares")
  void erasingRemovesRows() throws Exception {
    var e = createEncounter(dm, """
        {"name": "Scratch", "map": {"width": 20, "height": 20, "cellFeet": 5,
         "cells": [{"x": 1, "y": 1, "terrain": "WALL"}, {"x": 2, "y": 2, "terrain": "WALL"}]}}
        """);
    String id = e.get("id").asText();

    mvc.perform(as(dm, post("/encounter/{id}/map/paint", id)).content("""
            [{"shape": "RECTANGLE", "x1": 0, "y1": 0, "x2": 5, "y2": 5, "erase": true}]
            """))
        .andExpect(status().isOk())
        // Sparse storage means an erased square has no row at all, not a row
        // full of nulls.
        .andExpect(jsonPath("$.map.cells.length()").value(0));
  }

  @Test
  @DisplayName("A stroke that is not an erase needs a brush")
  void strokeWithoutABrushIsRejected() throws Exception {
    var e = createEncounter(dm, "{\"name\": \"Blank\"}");
    String id = e.get("id").asText();

    mvc.perform(as(dm, post("/encounter/{id}/map/paint", id)).content("""
            [{"shape": "RECTANGLE", "x1": 1, "y1": 1, "x2": 2, "y2": 2}]
            """))
        .andExpect(status().isBadRequest());
  }

  private static void assertBoard(JsonNode e, int width, int height, int cellFeet) {
    var map = e.get("map");
    assertThat(map.get("width").asInt()).isEqualTo(width);
    assertThat(map.get("height").asInt()).isEqualTo(height);
    assertThat(map.get("cellFeet").asInt()).isEqualTo(cellFeet);
  }
}