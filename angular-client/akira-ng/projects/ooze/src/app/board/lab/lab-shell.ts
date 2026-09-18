const DIFF_WIDE = 480;

export interface Reading {
  readonly name: string;
  readonly ms: number;
  readonly sceneMs: number;
  readonly costs: string;
  readonly change: number;
  readonly control: number;
}

function grab(canvas: HTMLCanvasElement): Promise<ImageData | null> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      const wide = DIFF_WIDE;
      const tall = Math.max(1, Math.round((canvas.height / canvas.width) * wide));
      const small = document.createElement('canvas');
      small.width = wide;
      small.height = tall;
      const ink = small.getContext('2d', { willReadFrequently: true });
      if (!ink) {
        resolve(null);
        return;
      }
      ink.drawImage(canvas, 0, 0, wide, tall);
      resolve(ink.getImageData(0, 0, wide, tall));
    });
  });
}

export function meanDiff(a: ImageData | null, b: ImageData | null): number {
  if (!a || !b || a.data.length !== b.data.length) {
    return 0;
  }
  let sum = 0;
  for (let at = 0; at < a.data.length; at += 4) {
    sum += Math.abs(a.data[at] - b.data[at])
      + Math.abs(a.data[at + 1] - b.data[at + 1])
      + Math.abs(a.data[at + 2] - b.data[at + 2]);
  }
  return sum / ((a.data.length / 4) * 3);
}

export { grab };
