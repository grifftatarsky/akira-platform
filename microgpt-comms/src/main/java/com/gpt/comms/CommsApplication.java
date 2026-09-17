package com.gpt.comms;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

@SpringBootApplication
@EnableJpaAuditing
public class CommsApplication {

  public static void main(String[] args) {
    SpringApplication.run(CommsApplication.class, args);
  }
}
