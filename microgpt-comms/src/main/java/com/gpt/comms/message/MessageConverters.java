package com.gpt.comms.message;

import com.gpt.comms.message.model.ContactMessage;
import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;

/**
 * Binds the contact form's slugs to their enums.
 *
 * <p>Same reason as the report's: Spring's default is {@code Enum.valueOf}, and a
 * null here becomes the sentence on the form rather than a binding failure.
 */
public final class MessageConverters {

  private MessageConverters() {}

  @Component
  public static class ProductConverter implements Converter<String, ContactMessage.Product> {
    @Override
    public ContactMessage.Product convert(String source) {
      return ContactMessage.Product.of(source);
    }
  }

  @Component
  public static class CategoryConverter implements Converter<String, ContactMessage.Category> {
    @Override
    public ContactMessage.Category convert(String source) {
      return ContactMessage.Category.of(source);
    }
  }
}
