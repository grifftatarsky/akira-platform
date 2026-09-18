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
 * How strong and what color sunlight is at a given elevation.
 *
 * <p>Both change together and both come from the same cause: low light travels
 * through more atmosphere, so it loses more of itself and loses the blue end
 * first. That is the whole of why evening is orange, and getting it from one
 * number means the knob cannot be set to a bright blue sunset.
 */
export function sunlight(elevation: number): { intensity: number; color: number } {
  if (elevation <= 0) {
    return { intensity: 0, color: 0x24304a };
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
    color: (byte(r) << 16) | (byte(g) << 8) | byte(b),
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

/**
 * How much light the ground is actually getting, in arbitrary but consistent
 * units.
 *
 * <p>Not the sun's intensity: a low sun is not much dimmer than a high one —
 * about two thirds as bright at fifteen degrees — but it strikes flat ground at
 * a grazing angle, and the cosine is where the light really goes. At noon a
 * horizontal surface sees nearly all of it; at thirteen degrees it sees a
 * fifth. That factor, times the dimmer sky, is why six in the evening rendered
 * as midnight while every number in the sun model was correct.
 */
export function daylight(elevation: number): number {
  const lift = Math.max(0, Math.sin(elevation * RAD));
  const sky = Math.max(0.12, Math.min(1, lift * 1.25));
  return sunlight(elevation).intensity * lift + 0.35 * sky;
}

/**
 * The exposure an eye would settle on at this elevation, relative to noon.
 *
 * <p>Because a camera with a fixed exposure is not what anyone has ever looked
 * at a field through. A real evening *is* a twentieth of noon and does not look
 * it, because the eye opens up — and a renderer that reproduces the ratio
 * faithfully has reproduced a photograph taken at the wrong setting rather than
 * the thing being photographed.
 *
 * <p>Partial on purpose. Full adaptation would make midnight look like noon and
 * take the time of day out of the picture entirely; the exponent leaves evening
 * clearly darker and clearly warmer than afternoon while keeping it a scene
 * somebody can play on. The ceiling is what stops true night from being lifted
 * into a grey fog.
 */
export function eyeExposure(elevation: number): number {
  const noon = daylight(75);
  return Math.min(3.2, Math.pow(noon / Math.max(0.05, daylight(elevation)), 0.62));
}

const POINTS = [
  'north', 'north-northeast', 'northeast', 'east-northeast',
  'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest',
  'west', 'west-northwest', 'northwest', 'north-northwest',
];

/** A compass bearing said the way a person would say it. */
export function bearingName(azimuth: number): string {
  const wrapped = ((azimuth % 360) + 360) % 360;
  return POINTS[Math.round(wrapped / 22.5) % 16];
}

/**
 * How many times its own height a thing's shadow runs, at this elevation.
 *
 * <p>The one number that turns "the sun is 36 degrees up" into something a
 * person can picture, because it is the thing they can see on the board.
 */
export function shadowStretch(elevation: number): number {
  if (elevation <= 0.5) {
    return Infinity;
  }
  return 1 / Math.tan(elevation * RAD);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "15 July", for a slider that runs over a year. */
export function dateLabel(dayOfYear: number): string {
  let day = Math.max(1, Math.min(365, Math.round(dayOfYear)));
  for (let month = 0; month < 12; month++) {
    if (day <= LENGTHS[month]) {
      return `${day} ${MONTHS[month]}`;
    }
    day -= LENGTHS[month];
  }
  return '31 December';
}

/**
 * Somewhere a latitude passes through, so the number means something.
 *
 * <p>A slider reading "51 degrees" tells a DM nothing. "About London" tells
 * them what the light does there, which is the whole reason the control exists.
 */
export function latitudeName(latitude: number): string {
  const north = Math.abs(latitude);
  if (north < 12) return 'the tropics';
  if (north < 26) return 'about Cuba';
  if (north < 34) return 'about Cairo';
  if (north < 41) return 'about Virginia';
  if (north < 47) return 'about northern Italy';
  if (north < 53) return 'about London';
  if (north < 60) return 'about Denmark';
  if (north < 66) return 'about Oslo';
  return 'the far north';
}
