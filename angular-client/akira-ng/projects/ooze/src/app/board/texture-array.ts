import {
  DataArrayTexture, LinearMipmapLinearFilter, LinearFilter, RGBAFormat, RepeatWrapping,
  SRGBColorSpace,
} from 'three';

/**
 * Several images of the same thing, as one texture the shader can pick between.
 *
 * <p><b>Why an array and not six samplers.</b> A fragment shader has a hard
 * limit on how many textures it can bind at once — sixteen on a great deal of
 * hardware — and this ground already wants a dozen for its layers, its mask,
 * its light and its shadows. Six grasses as six samplers would not fit. As one
 * array they are a single binding and the layer is an argument, so adding a
 * seventh grass costs nothing but memory.
 *
 * <p>Built by decoding each image through a canvas, because WebGL will not
 * upload a JPEG into an array texture directly — the layers have to be raw
 * pixels in one contiguous buffer, and the browser's only decoder is the one
 * attached to `<canvas>`.
 */
export async function loadTextureArray(
  urls: readonly string[],
  isColor: boolean,
  matchTone = false,
): Promise<DataArrayTexture | null> {
  const images = await Promise.all(urls.map(load));
  const ready = images.filter((i): i is HTMLImageElement => i !== null);
  if (ready.length === 0) {
    return null;
  }

  // Every layer must be the same size, so the first one sets it and the rest
  // are drawn to fit. They are all 1k from the same library, so this is a
  // safety net rather than a scaling step.
  const width = ready[0].naturalWidth;
  const height = ready[0].naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }

  const data = new Uint8Array(width * height * 4 * ready.length);
  ready.forEach((image, layer) => {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    data.set(ctx.getImageData(0, 0, width, height).data, layer * width * height * 4);
  });

  if (matchTone) {
    levelTones(data, width * height, ready.length);
  }

  const texture = new DataArrayTexture(data, width, height, ready.length);
  texture.format = RGBAFormat;
  if (isColor) {
    texture.colorSpace = SRGBColorSpace;
  }
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  // Mipmapped, or ground seen at a distance turns to noise — and this is
  // ground that is nearly always seen at a distance.
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Pulls every layer to a common average color.
 *
 * <p><b>Variety of pattern, not of hue.</b> Six photographs of grass from a
 * library are six different lawns on six different days: one is dark and dense,
 * one is a clipped bright green, one has moss through it. Swapped between per
 * cell, that reads as camouflage — irregular patches of visibly different
 * green, which is a worse artifact than the tiling it was meant to cure,
 * because at least tiling is regular enough to ignore.
 *
 * <p>Scaling each layer so its mean matches the mean of all of them keeps
 * exactly what was wanted — a different arrangement of blades, a different
 * clump of clover, different wear — and discards what was not. The board's own
 * color variation then puts the tonal difference back where it belongs: across
 * tens of feet, following the ground, rather than in seven-foot blotches.
 */
function levelTones(data: Uint8Array, pixels: number, layers: number): void {
  const means: number[][] = [];
  for (let layer = 0; layer < layers; layer++) {
    const sum = [0, 0, 0];
    const at = layer * pixels * 4;
    for (let i = 0; i < pixels; i++) {
      sum[0] += data[at + i * 4];
      sum[1] += data[at + i * 4 + 1];
      sum[2] += data[at + i * 4 + 2];
    }
    means.push(sum.map(v => v / pixels));
  }

  const target = [0, 1, 2].map(c => means.reduce((t, m) => t + m[c], 0) / layers);
  for (let layer = 0; layer < layers; layer++) {
    const at = layer * pixels * 4;
    const scale = [0, 1, 2].map(c => target[c] / Math.max(1, means[layer][c]));
    for (let i = 0; i < pixels; i++) {
      for (let c = 0; c < 3; c++) {
        data[at + i * 4 + c] = Math.min(255, Math.round(data[at + i * 4 + c] * scale[c]));
      }
    }
  }
}

function load(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      console.warn('[board] no texture at %s — that variant will be missing', url);
      resolve(null);
    };
    image.src = new URL(url, import.meta.url).href;
  });
}
