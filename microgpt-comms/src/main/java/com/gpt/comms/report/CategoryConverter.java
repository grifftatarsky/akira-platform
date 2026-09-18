package com.gpt.comms.report;

import com.gpt.comms.report.model.AbuseReport;
import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;

/**
 * Binds the form's category slug to the enum.
 *
 * <p>Spring's own string-to-enum conversion is {@code Enum.valueOf}, so
 * {@code child-sexual} would arrive as a binding failure rather than a value.
 * Returning null for something unrecognised leaves the {@code @NotNull} on the
 * submission to produce the sentence the reporter reads, instead of a stack
 * trace about a conversion.
 */
@Component
public class CategoryConverter implements Converter<String, AbuseReport.Category> {

  @Override
  public AbuseReport.Category convert(String source) {
    return AbuseReport.Category.of(source);
  }
}
