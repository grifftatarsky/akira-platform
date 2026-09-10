/**
 * Where the sun is.
 *
 * <p>Computed rather than dialled, because "one in the afternoon in July" is a
 * fact about the sky and not a preference about lighting. Given a latitude, a
 * day and an hour it produces the same elevation and bearing an almanac would
 * — so the shadows on the board fall where they would fall, and moving the
 * clock moves them the way the day actually moves them.
 *
 * <p>Standard solar-position geometry, in the simple form: declination from the
 * day of year, hour angle from solar time, and the two combined into elevation
 * and azimuth. It ignores the equation of time and any longitude offset, which
 * between them are worth a few minutes of clock — irrelevant when the input is
 * a slider a DM is dragging.
 */

export interface SunPosition {
  /** Degrees above the horizon. Negative is below it. */
  readonly elevation: number;
  /** Compass bearing in degrees: 0 north, 90 east, 180 south. */
  readonly azimuth: number;
}

const RAD = Math.PI / 180;

/** The sun's declination for a day of the year, in degrees. */
export function declination(dayOfYear: number): number {
  return 23.44 * Math.sin(RAD * (360 / 365) * (dayOfYear + 284));
}

/**
 * The sun at a given hour, in solar time.
 *
 * @param hour 0 to 24, where 12 is local solar noon
 * @param latitude degrees north
 */
export function sunPosition(hour: number, latitude: number, dayOfYear: number): SunPosition {
  const dec = declination(dayOfYear) * RAD;
  const lat = latitude * RAD;
  // Fifteen degrees an hour, which is what a rotating planet does.
  const hourAngle = (hour - 12) * 15 * RAD;

  const sinElevation =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation)));

  const cosAzimuth =
    (Math.sin(dec) - Math.sin(elevation) * Math.sin(lat)) /
    Math.max(1e-6, Math.cos(elevation) * Math.cos(lat));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzimuth))) / RAD;
  // Before noon the sun is east of south, after it is west; the cosine cannot
  // tell those apart on its own.
  if (hourAngle > 0) {
    azimuth = 360 - azimuth;
  }
  return { elevation: elevation / RAD, azimuth };
}

/**
 * How strong and what colour sunlight is at a given elevation.
 *
 * <p>Both change together and both come from the same cause: low light travels
 * through more atmosphere, so it loses more of itself and loses the blue end
 * first. That is the whole of why evening is orange, and getting it from one
 * number means the knob cannot be set to a bright blue sunset.
 */
export function sunlight(elevation: number): { intensity: number; colour: number } {
  if (elevation <= 0) {
    return { intensity: 0, colour: 0x24304a };
  }
  // Air mass, roughly: one at the zenith and rising sharply near the horizon.
  const mass = 1 / Math.max(0.06, Math.sin(elevation * RAD));
  const survives = Math.pow(0.76, Math.pow(mass, 0.6));

  // The blue end scatters out first, so the ratios diverge as the mass rises.
  const r = Math.pow(0.86, Math.pow(mass, 0.55));
  const g = Math.pow(0.72, Math.pow(mass, 0.62));
  const b = Math.pow(0.56, Math.pow(mass, 0.7));
  const peak = Math.max(r, g, b);
  const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v / peak)) * 255);

  return {
    intensity: 3.4 * survives,
    colour: (byte(r) << 16) | (byte(g) << 8) | byte(b),
  };
}

/** "1:20 pm", for a label under a slider. */
export function clockLabel(hour: number): string {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  const suffix = whole < 12 ? 'am' : 'pm';
  const shown = whole % 12 === 0 ? 12 : whole % 12;
  return `${shown}:${String(minutes).padStart(2, '0')} ${suffix}`;
}
