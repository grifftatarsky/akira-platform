package com.gpt.springbonk.service.openlibrary;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.json.JsonMapper;

/**
 * The work key is concatenated into the outbound request path, so these cover
 * the guard that keeps a caller-supplied value from steering that path. No
 * network is involved: malformed cases are rejected before a request is built,
 * while valid cases use a mocked response.
 */
class OpenLibraryClientTest {

  private MockRestServiceServer server;
  private OpenLibraryClient client;

  @BeforeEach
  void setUp() {
    RestClient.Builder restClientBuilder = RestClient.builder()
        .baseUrl("https://openlibrary.org");
    server = MockRestServiceServer.bindTo(restClientBuilder).build();
    client = new OpenLibraryClient(JsonMapper.builder().build(), restClientBuilder.build());
  }

  @ParameterizedTest
  @DisplayName("refuses keys that could change the request path")
  @ValueSource(strings = {
      "../../admin",
      "OL1W/../../else",
      "OL1W?foo=bar",
      "OL1W#fragment",
      "OL1W.json/../../x",
      "{template}",
      "OL1W ",
      "not-a-key",
      "OL1M",          // edition key, not a work key
      "ol1w",          // wrong case
      "OLW",           // no digits
  })
  void refusesMalformedKeys(String key) {
    assertThat(client.fetchWorkDescription(key)).isEmpty();
  }

  @Test
  @DisplayName("treats null and blank as nothing to fetch")
  void handlesEmptyInput() {
    assertThat(client.fetchWorkDescription(null)).isEmpty();
    assertThat(client.fetchWorkDescription("")).isEmpty();
    assertThat(client.fetchWorkDescription("   ")).isEmpty();
  }

  private static Stream<Arguments> wellFormedWorkKeys() {
    return Stream.of(
        Arguments.of("OL45804W", "https://openlibrary.org/works/OL45804W.json"),
        Arguments.of("/works/OL45804W", "https://openlibrary.org/works/OL45804W.json"),
        Arguments.of("works/OL45804W", "https://openlibrary.org/works/OL45804W.json"),
        Arguments.of("OL1W", "https://openlibrary.org/works/OL1W.json"));
  }

  /**
   * Well-formed keys must survive normalization and reach the request stage.
   * The request is mocked so the test does not depend on the live Open Library
   * API or on the availability of a particular work record.
   */
  @ParameterizedTest
  @DisplayName("accepts well-formed work keys in each supported shape")
  @MethodSource("wellFormedWorkKeys")
  void acceptsWellFormedKeys(String key, String expectedUri) {
    server.expect(requestTo(expectedUri))
        .andRespond(withSuccess(
            "{\"description\":{\"value\":\"A test description\"}}",
            MediaType.APPLICATION_JSON));

    assertThat(client.fetchWorkDescription(key))
        .contains("A test description");

    server.verify();
  }
}
