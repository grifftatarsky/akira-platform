package com.gpt.oozengine;

import static org.assertj.core.api.Assertions.assertThat;

import com.gpt.oozengine.constant.rules.TerrainKind;
import com.gpt.oozengine.util.Falling;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * Falling, against the SRD's own sentence.
 *
 * <p>"A creature that falls takes 1d6 Bludgeoning damage at the end of the fall
 * for every 10 feet it fell, to a maximum of 20d6. When the creature lands, it
 * has the Prone condition unless it avoids taking any damage from the fall."
 */
class FallingTests {

  @ParameterizedTest(name = "{0} feet is {1}d6")
  @CsvSource({"0,0", "5,0", "9,0", "10,1", "19,1", "20,2", "100,10", "200,20", "500,20"})
  @DisplayName("A d6 for every full ten feet, and no more than twenty")
  void diceRoundDownAndCap(int feet, int dice) {
    var damage = Falling.damage(feet);

    // "for every 10 feet it fell" — nine feet is nothing and nineteen is one d6.
    // Rounding up would make every step off a low wall cost a die, which is a
    // quiet generosity that makes a simulator disagree with a table.
    if (dice == 0) {
      assertThat(damage).isNull();
    } else {
      assertThat(damage.getCount()).isEqualTo(dice);
      assertThat(damage.getFaces()).isEqualTo(6);
    }
  }

  @Test
  @DisplayName("Past two hundred feet, more height costs nothing")
  void terminal() {
    assertThat(Falling.terminalFeet()).isEqualTo(200);
    assertThat(Falling.damage(200).getCount()).isEqualTo(Falling.damage(10_000).getCount());
  }

  @Test
  @DisplayName("The printed average matches the dice")
  void averageIsCarried() {
    // 10d6 averages 35, and the book prints the rounded value beside the dice.
    assertThat(Falling.damage(100).getAverage()).isEqualTo(35);
    assertThat(Falling.damage(100).expression()).isEqualTo("10d6");
  }

  @Test
  @DisplayName("Prone is keyed to damage taken, not to how far it fell")
  void proneFollowsDamage() {
    // "unless it avoids taking any damage from the fall" — a creature that fell
    // two hundred feet and shrugged off every die is still on its feet.
    assertThat(Falling.landsProne(1)).isTrue();
    assertThat(Falling.landsProne(0)).isFalse();
  }

  @Test
  @DisplayName("A good landing in water halves the damage")
  void liquidLanding() {
    assertThat(Falling.LIQUID_CHECK_DC).isEqualTo(15);
    assertThat(Falling.isLiquid(TerrainKind.WATER)).isTrue();
    assertThat(Falling.isLiquid(TerrainKind.DEEP_WATER)).isTrue();
    assertThat(Falling.isLiquid(TerrainKind.FLOOR)).isFalse();
    assertThat(Falling.halved(35)).isEqualTo(17);
  }

  @Test
  @DisplayName("Walking uphill is not a negative fall")
  void dropIsNeverNegative() {
    assertThat(Falling.dropBetween(30, 0)).isEqualTo(30);
    assertThat(Falling.dropBetween(0, 30)).isZero();
    assertThat(Falling.dropBetween(10, 10)).isZero();
  }
}
