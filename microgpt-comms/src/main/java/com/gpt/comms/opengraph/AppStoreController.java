package com.gpt.comms.opengraph;

import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Server-rendered metadata for links shared from the app. */
@RestController
@RequestMapping("/share")
@RequiredArgsConstructor
public class AppStoreController {

  private static final String TITLE = "•bullet | App Store";
  private static final String DESCRIPTION = "A quiet list from Outpost";
  private static final String IMAGE_PATH = "/shareimg/bullet.png";
  private static final String APP_STORE_LINK = "https://apps.apple.com/us/app/bullet/id6812961777";

  @Value("${app.public-origin:https://localhost}")
  private String publicOrigin;

  @GetMapping(path = "/bullet/appstore", produces = MediaType.TEXT_HTML_VALUE)
  public ResponseEntity<String> sharePage() {
    String origin = sanitizePublicOrigin(publicOrigin);
    String imageUrl = origin + IMAGE_PATH;

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
            <script>
              // Redirect humans, bots will ignore this
              window.location.replace("%s");
            </script>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding-top: 50px; color: #333;">
            <p>Redirecting to the App Store...</p>
            <p style="font-size: 14px; color: #666;">
              If you are not redirected, <a href="%s" style="color: #007aff; text-decoration: none;">click here</a>.
            </p>
          </body>
        </html>
        """
            .formatted(
                escape(TITLE),
                escape(DESCRIPTION),
                escape(TITLE),
                escape(DESCRIPTION),
                escape(imageUrl),
                escape(APP_STORE_LINK),
                escape(APP_STORE_LINK),
                escape(APP_STORE_LINK), // For JS redirect
                escape(APP_STORE_LINK)  // For fallback link
            );

    return ResponseEntity.ok()
        .contentType(new MediaType(MediaType.TEXT_HTML, StandardCharsets.UTF_8))
        .body(html);
  }

  static String sanitizePublicOrigin(String configuredOrigin) {
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

  static String escape(String value) {
    return value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;");
  }
}