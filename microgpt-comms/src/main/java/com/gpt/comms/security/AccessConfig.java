package com.gpt.comms.security;

import com.c4_soft.springaddons.security.oidc.starter.synchronised.resourceserver.ResourceServerExpressionInterceptUrlRegistryPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;

/**
 * Posting a report needs no account; everything else needs one.
 *
 * <p>Reading is the other half of it. Everything under {@code /desk} carries what
 * somebody was sent and how to reach them, so being signed in is not enough —
 * it takes the {@code COMMS_DESK} realm role, granted to one person. Any other
 * account in the realm gets a 403, which is the point: the realm has users who
 * are here for a card game.
 *
 * <p>This is the inverse of the sticker wall, where reading is public and writing
 * is not. Somebody reporting abuse is very often somebody who wants less to do
 * with this app rather than more, and requiring them to sign in first would be a
 * barrier in front of the one screen that must not have any. The path is granted
 * per-method rather than through {@code permit-all}, which takes plain patterns
 * and would open the path to every verb.
 */
@Configuration
public class AccessConfig {

  @Bean
  ResourceServerExpressionInterceptUrlRegistryPostProcessor authorizePostProcessor() {
    return registry ->
        registry
            .requestMatchers(HttpMethod.POST, "/reports", "/messages")
            .permitAll()
            .requestMatchers("/desk/**")
            .hasAuthority("COMMS_DESK")
            .anyRequest()
            .authenticated();
  }
}
