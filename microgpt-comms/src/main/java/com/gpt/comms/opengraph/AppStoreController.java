package com.gpt.comms.opengraph;

import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/// Making endpoints for cleaner UI for share links.
@RestController
@RequestMapping("/share")
@RequiredArgsConstructor
public class AppStoreController {

    @GetMapping(path = "/bullet/appstore", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> sharePage() {
      // Render escaped title, description, canonical URL and image URL
      // into the initial HTML response.
  }
}
