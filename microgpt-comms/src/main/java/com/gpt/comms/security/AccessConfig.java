package com.gpt.comms.security;

import com.c4_soft.springaddons.security.oidc.starter.synchronised.resourceserver.ResourceServerExpressionInterceptUrlRegistryPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;

/** Public and protected HTTP access rules for comms. */
@Configuration
public class AccessConfig {

  @Bean
  ResourceServerExpressionInterceptUrlRegistryPostProcessor authorizePostProcessor() {
    return registry ->
        registry
            .requestMatchers(HttpMethod.POST, "/reports", "/messages")
            .permitAll()
            .requestMatchers(HttpMethod.GET, "/blog/**", "/share/**", "/shareimg/**")
            .permitAll()
            .requestMatchers("/desk/**")
            .hasAuthority("COMMS_DESK")
            .anyRequest()
            .authenticated();
  }
}
