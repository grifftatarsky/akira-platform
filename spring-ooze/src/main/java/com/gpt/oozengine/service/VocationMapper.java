package com.gpt.oozengine.service;

import com.gpt.oozengine.constant.rules.Activation;
import com.gpt.oozengine.constant.rules.UsesReset;
import com.gpt.oozengine.model.ClassValue;
import com.gpt.oozengine.model.Vocation;
import com.gpt.oozengine.model.VocationLevel;
import com.gpt.oozengine.model.dto.request.VocationFeatureRequest;
import com.gpt.oozengine.model.dto.request.VocationLevelRequest;
import com.gpt.oozengine.model.mechanics.Feature;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The level table and the features of a class, applied from an edit.
 *
 * <p>Two different keys, for two different reasons. A **level** is matched on
 * its number: a class table's rows are never created or destroyed, they are
 * edited in place, and 1 through 20 is a better identity than an id the client
 * has to carry. A **feature** is matched on its id, the same as a creature's,
 * because its identity is referenced — by the level a character gained it at,
 * and by anything the simulator logs.
 */
@Component
public class VocationMapper {

  /** A null list means "leave them alone", not "delete them all". */
  public void applyLevels(List<VocationLevelRequest> requested, Vocation v) {
    if (requested == null) {
      return;
    }
    Map<Integer, VocationLevel> existing = new HashMap<>();
    v.getLevels().forEach(l -> existing.put(l.getLevel(), l));

    List<VocationLevel> next = new ArrayList<>();
    for (VocationLevelRequest r : requested) {
      VocationLevel level = existing.getOrDefault(r.level(), new VocationLevel());
      level.setLevel(r.level());
      level.setProficiencyBonus(r.proficiencyBonus());
      level.setFeatureSummary(blankToNull(r.featureSummary()));
      level.setCantripsKnown(r.cantripsKnown());
      level.setPreparedSpells(r.preparedSpells());

      level.getSpellSlots().clear();
      if (r.spellSlots() != null) {
        // A slot count of zero is not a slot; the book prints a dash.
        r.spellSlots().forEach(
            (slot, count) -> {
              if (count != null && count > 0) {
                level.getSpellSlots().put(slot, count);
              }
            });
      }

      level.getClassValues().clear();
      if (r.classValues() != null) {
        r.classValues().stream()
            .filter(c -> notBlank(c.label()) && notBlank(c.value()))
            .forEach(c -> level.getClassValues().add(new ClassValue(c.label().trim(), c.value())));
      }
      next.add(level);
    }
    // Mutated in place: replacing the list defeats orphanRemoval, so a dropped
    // level would be orphaned rather than deleted.
    v.getLevels().clear();
    v.getLevels().addAll(next);
  }

  public void applyFeatures(List<VocationFeatureRequest> requested, Vocation v) {
    if (requested == null) {
      return;
    }
    Map<UUID, Feature> existing = new HashMap<>();
    v.getFeatures().forEach(f -> existing.put(f.getId(), f));

    List<Feature> next = new ArrayList<>();
    int ordinal = 0;
    for (VocationFeatureRequest r : requested) {
      Feature f = r.id() == null ? new Feature() : existing.get(r.id());
      if (f == null) {
        f = new Feature(); // an id the client made up, or one already deleted
      }
      f.setName(r.name());
      f.setDescription(blankToNull(r.description()));
      f.setVocationLevel(r.vocationLevel());
      f.setSubclassId(r.subclassId());
      f.setActivation(r.activation() == null ? Activation.PASSIVE : r.activation());
      f.setUsesReset(r.usesReset() == null ? UsesReset.AT_WILL : r.usesReset());
      f.setOrdinal(ordinal++);
      next.add(f);
    }
    v.getFeatures().clear();
    v.getFeatures().addAll(next);
  }

  /** The level table's rows in order, however the client sent them. */
  public static List<VocationLevelRequest> ordered(List<VocationLevelRequest> levels) {
    if (levels == null) {
      return null;
    }
    Map<Integer, VocationLevelRequest> byLevel = new TreeMap<>();
    levels.forEach(l -> byLevel.put(l.level(), l));
    return List.copyOf(byLevel.values());
  }

  private static boolean notBlank(String s) {
    return s != null && !s.isBlank();
  }

  private static String blankToNull(String s) {
    return notBlank(s) ? s : null;
  }
}
