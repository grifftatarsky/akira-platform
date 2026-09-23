package com.gpt.comms.opengraph;

import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
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

  @Value("${BULLET_APP_STORE_LINK}")
  private String appStoreLink;

  @GetMapping(path = "/bullet/appstore", produces = MediaType.TEXT_HTML_VALUE)
  public ResponseEntity<String> sharePage(
      @RequestHeader(value = "X-Forwarded-Proto", required = false) String forwardedProto,
      @RequestHeader(value = "Host", required = false) String host) {
    String origin = origin(forwardedProto, host);
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

    return ResponseEntity.ok()
        .contentType(new MediaType(MediaType.TEXT_HTML, StandardCharsets.UTF_8))
        .body(html);
  }

  @GetMapping(path = "/../shareimg/bullet.png", produces = MediaType.IMAGE_PNG_VALUE)
  public Resource bulletImage() {
    return new ClassPathResource("shareimg/bullet.png");
  }

  private static String origin(String forwardedProto, String host) {
    String scheme = firstHeaderValue(forwardedProto, "https");
    String forwardedHost = firstHeaderValue(host, "localhost");
    return scheme + "://" + forwardedHost;
  }

  private static String firstHeaderValue(String value, String fallback) {
    if (value == null || value.isBlank()) {
      return fallback;
    }
    return value.split(",", 2)[0].trim();
  }

  private static String escape(String value) {
    return value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;");
  }
}
