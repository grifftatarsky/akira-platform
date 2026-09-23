package com.gpt.comms.opengraph;

import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Server-rendered metadata for links shared from the app. */
// TODO: Security scan this shit...
@RestController
@RequestMapping("/share")
@RequiredArgsConstructor
public class AppStoreController {

  // TODO: Make a service. This is really just so I can get this out of the door.

  // region Static
  private static final String TITLE = "•bullet | App Store";
  private static final String DESCRIPTION = "A quiet list from Outpost";
  private static final String IMAGE_PATH = "/shareimg/bullet.png";
  // endregion

  @Value("${app.public-origin:https://localhost}")
  private String publicOrigin;

  @GetMapping(path = "/bullet/appstore", produces = MediaType.TEXT_HTML_VALUE)
  public ResponseEntity<String> sharePage() {
    String origin = sanitizePublicOrigin(publicOrigin);
    String imageUrl = origin + IMAGE_PATH;

    // region HTML String
    // ew hardcode. I'm tired. TODO
    String appStoreLink = "https://apps.apple.com/us/app/bullet/id6812961777";
    String html =
        """
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>%s</title>
            <meta name="description" content="%s">
            <meta property="og:title" content="%s">
            <meta property="og:description" content="%s">
            <meta property="og:image" content="%s">
            <meta property="og:url" content="%s">
            <meta property="og:type" content="website">
            <link rel="canonical" href="%s">
          </head>
          <body>
            <p><a href="%s">%s</a></p>
          </body>
        </html>
        """
            .formatted(
                escape(TITLE),
                escape(DESCRIPTION),
                escape(TITLE),
                escape(DESCRIPTION),
                escape(imageUrl),
                escape(appStoreLink),
                escape(appStoreLink),
                escape(appStoreLink),
                escape(TITLE));
    // endregion

    return ResponseEntity.ok()
        .contentType(new MediaType(
            MediaType.TEXT_HTML,
            StandardCharsets.UTF_8
        )).body(html);
  }

  @GetMapping(path = "/../shareimg/bullet.png", produces = MediaType.IMAGE_PNG_VALUE)
  public Resource bulletImage() {
    return new ClassPathResource("shareimg/bullet.png");
  }

  private static String sanitizePublicOrigin(String configuredOrigin) {
    if (configuredOrigin == null || configuredOrigin.isBlank()) {
      return "https://localhost";
    }

    String trimmed = configuredOrigin.trim();
    if (trimmed.endsWith("/")) {
      trimmed = trimmed.substring(0, trimmed.length() - 1);
    }

    if (trimmed.matches("^https?://[a-z0-9.-]+(?::\\d{1,5})?$")) {
      return trimmed;
    }
    return "https://localhost";
  }

  private static String escape(String value) {
    return value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;");
  }
}
