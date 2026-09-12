export interface Slice {
  readonly name: string;
  readonly ms: number;
  readonly share: number;
}

export interface Knob {
  readonly name: string;
  set(on: boolean): void;
}

const SETTLE = 20;
const SAMPLE = 90;

export function frameMs(): Promise<number> {
  const gaps: number[] = [];
  return new Promise<number>(done => {
    let seen = 0;
    let last = performance.now();
    const tick = (): void => {
      const now = performance.now();
      if (seen++ > SETTLE) {
        gaps.push(now - last);
      }
      last = now;
      if (gaps.length >= SAMPLE) {
        gaps.sort((a, b) => a - b);
        done(gaps[gaps.length >> 1] ?? 0);
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
}

export async function splitFrame(knobs: readonly Knob[]): Promise<Slice[]> {
  const whole = await frameMs();
  const slices: Slice[] = [{ name: 'whole frame', ms: round(whole), share: 1 }];
  let named = 0;
  for (const knob of knobs) {
    let without = whole;
    try {
      knob.set(false);
      without = await frameMs();
    } finally {
      knob.set(true);
    }
    const cost = Math.max(0, whole - without);
    named += cost;
    slices.push({ name: knob.name, ms: round(cost), share: share(cost, whole) });
  }
  const rest = Math.max(0, whole - named);
  slices.push({ name: 'unattributed', ms: round(rest), share: share(rest, whole) });
  return slices;
}

function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

function round(ms: number): number {
  return Number(ms.toFixed(2));
}
