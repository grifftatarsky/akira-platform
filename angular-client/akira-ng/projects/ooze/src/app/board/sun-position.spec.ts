import { clockLabel, sunPosition, sunlight } from './sun-position';

/**
 * The sun, against what an almanac says.
 *
 * <p>Worth checking rather than eyeballing: the whole reason to compute this
 * instead of dialling an angle is that it should agree with the sky, and a
 * shadow falling the wrong way is the kind of error a scene hides well.
 */
describe('sun position', () => {

  /** Mid-July, about the latitude of Richmond, Virginia. */
  const SUMMER = 196;
  const RICHMOND = 37.5;

  it('puts the midsummer noon sun high and due south', () => {
    const noon = sunPosition(12, RICHMOND, SUMMER);

    // Elevation at noon is 90 - latitude + declination: 90 - 37.5 + 21.5 = 74.
    expect(noon.elevation).toBeCloseTo(74, 0);
    expect(noon.azimuth).toBeCloseTo(180, 0);
  });

  it('swings east in the morning and west in the afternoon', () => {
    // The cosine alone cannot tell the two halves of the day apart, so this is
    // the assertion that catches the classic mirrored-shadows bug.
    expect(sunPosition(9, RICHMOND, SUMMER).azimuth).toBeLessThan(180);
    expect(sunPosition(15, RICHMOND, SUMMER).azimuth).toBeGreaterThan(180);
  });

  it('drops as the afternoon wears on', () => {
    const one = sunPosition(13, RICHMOND, SUMMER).elevation;
    const four = sunPosition(16, RICHMOND, SUMMER).elevation;
    const seven = sunPosition(19, RICHMOND, SUMMER).elevation;

    expect(one).toBeGreaterThan(four);
    expect(four).toBeGreaterThan(seven);
  });

  it('sets in midsummer at about ten past seven, solar time', () => {
    // cos(H) = -tan(latitude) * tan(declination) puts the hour angle at 107.6
    // degrees, which is 7.17 hours after noon.
    expect(sunPosition(19.1, RICHMOND, SUMMER).elevation).toBeGreaterThan(0);
    expect(sunPosition(19.3, RICHMOND, SUMMER).elevation).toBeLessThan(0);
  });

  it('is lower in winter than in summer at the same hour', () => {
    expect(sunPosition(12, RICHMOND, 355).elevation)
      .toBeLessThan(sunPosition(12, RICHMOND, SUMMER).elevation);
  });

  describe('light', () => {

    it('is brightest overhead and dims toward the horizon', () => {
      expect(sunlight(74).intensity).toBeGreaterThan(sunlight(30).intensity);
      expect(sunlight(30).intensity).toBeGreaterThan(sunlight(5).intensity);
    });

    it('reddens as it falls, because the blue end scatters out first', () => {
      const blueness = (c: number) => (c & 0xff) / ((c >> 16) & 0xff);

      expect(blueness(sunlight(5).color)).toBeLessThan(blueness(sunlight(74).color));
    });

    it('goes out below the horizon', () => {
      expect(sunlight(-1).intensity).toBe(0);
    });
  });

  it('reads the clock the way a person would', () => {
    expect(clockLabel(13.5)).toBe('1:30 pm');
    expect(clockLabel(12)).toBe('12:00 pm');
    expect(clockLabel(6.25)).toBe('6:15 am');
  });
});
