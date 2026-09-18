package com.gpt.comms.message;

import com.gpt.comms.message.model.ContactMessage;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ContactMessageRepository extends JpaRepository<ContactMessage, UUID> {}
