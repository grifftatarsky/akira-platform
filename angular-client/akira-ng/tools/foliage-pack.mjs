// Compose every plant's cut-outs into one sheet the board can sample.
//
// <b>Why one sheet.</b> Five species is five meshes and five materials; sharing
// a texture makes them five draws of one material instead, and leaves the door
// open to merging them entirely. It also means a plant can mix sources — a
// daisy is a scanned flower head over scanned basal leaves, which came out of
// two different packs.
//
// <b>The colour has to be bled outward before the alpha is attached.</b>
// Outside a cut-out the colour is whatever the scanner left — white in
// ambientCG's split maps, black in a PNG that already carries alpha. Nothing
// authored it, because nothing was meant to read it; but a bilinear sample near
// the silhouette edge mixes it in, and every leaf gets a halo that is invisible
// in the source files and obvious on a card. So the colour is dilated into the
// transparent region far enough to cover any mip the sampler will ask for, and
// only then does the opacity go into alpha.
//
// The work is done in the browser already open on the CDP port: it has the same
// PNG decoder the app will use, and the alternative is a native image
// dependency for a script that runs when an asset changes.
//
// Usage: node tools/foliage-pack.mjs <srcDir> <outDir>
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.CDP_PORT || 9333;
const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) { console.error('usage: foliage-pack.mjs <srcDir> <outDir>'); process.exit(1); }

/** The sheet, and how large one cut-out is allowed to be stored. */
const SHEET = 2048;
const LONGEST = 300;

/**
 * How many heights the silhouette's width is recorded at.
 *
 * <p><b>This is the whole point of the tool now.</b> A card is a quad and a
 * quad is a bounding box, and a scanned grass blade fills about a fifth of its
 * box — so four fifths of every fragment that card produces is shaded and then
 * thrown away by the alpha test, which is measured to be the entire remaining
 * cost of this meadow.
 *
 * <p>The geometry is already rows of two vertices. Moving those two vertices to
 * where the leaf actually starts and stops at that height turns the box into a
 * fitted strip for no extra vertices at all — the card gets narrower, not more
 * complicated. Thirteen samples is finer than any card is subdivided, so the
 * geometry interpolates between them rather than the other way round.
 */
const SPANS = 13;

/**
 * Where the cut-outs come from, and what each group is called.
 *
 * <p>ambientCG splits colour and opacity into two files; OpenGameArt's clover
 * is one PNG that already carries alpha. Both end up in the same place.
 *
 * <p><b>Foliage003 is the obvious one to want and it is not here.</b> Its four
 * grass stems with seed heads are exactly the Yorkshire fog, and they lie
 * across the sheet at forty degrees — so their axis-aligned bounding boxes
 * overlap heavily and a card cropped to one carries pieces of its neighbours.
 * Cropping cut-outs that are not upright needs a rotated fit, which is a
 * different tool. The seed heads are built from the blade sheet's sprays.
 */
/**
 * Cut-outs that are composed rather than cropped.
 *
 * <p><b>A tree canopy cannot be built from single leaves.</b> Scanned sets give
 * one leaf at a time, and a card carrying one leaf means several hundred cards a
 * tree, which is a tree that costs more than the meadow it stands in. What a
 * canopy card wants is a *clump* — twenty leaves at assorted angles filling one
 * cut-out — and nothing CC0 ships one.
 *
 * <p>So it is composed here: the leaves of a set are scattered, rotated and
 * scaled into one sheet, and the result is cropped and measured like any other
 * cut-out. Three seeds give three clumps, so the trees on a board are not all
 * the same tree. It is the same trick a foliage artist does by hand, done by a
 * build step against a scan.
 */
const CLUMPS = [
  { dir: 'LeafSet005_1K', stem: 'LeafSet005_1K-PNG', group: 'canopy', seeds: 4, leaves: 46 },
  { dir: 'LeafSet016_1K', stem: 'LeafSet016_1K-PNG', group: 'canopy', seeds: 4, leaves: 46 },
];

const SOURCES = [
  {
    dir: 'acg/Foliage006_1K', stem: 'Foliage006_1K-PNG',
    // One sheet holds both single blades and two-or-three blade sprays; the
    // proportions tell them apart without anyone naming them.
    group: cut => (cut.u1 - cut.u0) / (cut.v1 - cut.v0) < 0.25 ? 'blade' : 'spray',
  },
  { dir: 'acg/LeafSet020_1K', stem: 'LeafSet020_1K-PNG', group: () => 'rosette' },
  { dir: 'acg/FlowerSet001_1K', stem: 'FlowerSet001_1K-PNG', group: () => 'daisy' },
  {
    files: [
      'clover/cc0_white_clover_cutouts/clover_close.png',
      'clover/cc0_white_clover_cutouts/clover_close2.png',
      'clover/cc0_white_clover_cutouts/vegetation_clover_02a.png',
    ],
    group: () => 'clover',
  },
  {
    files: ['clover/cc0_white_clover_cutouts/trifolium_repens_macro.png'],
    group: () => 'cloverBloom',
  },
];

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find(t => t.type === 'page');
if (!page) { console.error('no page target on the CDP port'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let next = 1;
const waiting = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const call = async (fn, args) => {
  const id = next++;
  const expression = `(${fn})(${args.map(a => JSON.stringify(a)).join(',')})`;
  const res = await new Promise(done => {
    waiting.set(id, done);
    ws.send(JSON.stringify({
      id, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  const value = res?.result?.result?.value;
  if (value === undefined) {
    console.error(JSON.stringify(res).slice(0, 600));
    process.exit(1);
  }
  return JSON.parse(value);
};


const CLUMP = `async (colorB64, alphaB64, leaves, seed, size) => {
  const load = b => new Promise((ok, no) => {
    const i = new Image();
    i.onload = () => ok(i); i.onerror = () => no(new Error('decode'));
    i.src = 'data:image/png;base64,' + b;
  });
  const colorImg = await load(colorB64);
  const alphaImg = alphaB64 ? await load(alphaB64) : null;
  const w = colorImg.naturalWidth, h = colorImg.naturalHeight;

  // Compose the source once, with its opacity attached, so a leaf can be
  // drawn from it by rectangle.
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sx = src.getContext('2d', { willReadFrequently: true });
  sx.drawImage(colorImg, 0, 0);
  const colour = sx.getImageData(0, 0, w, h);
  let op = null;
  if (alphaImg) {
    sx.clearRect(0, 0, w, h);
    sx.drawImage(alphaImg, 0, 0, w, h);
    op = sx.getImageData(0, 0, w, h);
  }
  const n = w * h;
  const flat = new Uint8ClampedArray(n * 4);
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = op ? op.data[i * 4] : colour.data[i * 4 + 3];
    solid[i] = a > 24 ? 1 : 0;
    flat[i * 4] = colour.data[i * 4];
    flat[i * 4 + 1] = colour.data[i * 4 + 1];
    flat[i * 4 + 2] = colour.data[i * 4 + 2];
    flat[i * 4 + 3] = a;
  }
  sx.putImageData(new ImageData(flat, w, h), 0, 0);

  // Where each leaf is, by flooding the opaque pixels.
  const seen = new Uint8Array(n);
  const boxes = [];
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (!solid[start] || seen[start]) continue;
    let top = 0; stack[top++] = start; seen[start] = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, count = 0;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i / w) | 0;
      count++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (solid[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
      }
    }
    if (count > n / 2000) boxes.push({ x0, y0, x1: x1 + 1, y1: y1 + 1 });
  }
  if (!boxes.length) return JSON.stringify({ error: 'no leaves' });

  // Scatter them into a clump. A fixed hash rather than Math.random, so the
  // sheet is the same every build — it is an asset, not a simulation.
  let state = seed * 2654435761 >>> 0;
  const rand = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };

  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const cx = cv.getContext('2d');
  cx.clearRect(0, 0, size, size);
  // <b>A spray along a stem, not a disc.</b> A round clump of leaves is a
  // pompom, and a canopy built from pompoms is a balloon with a texture on it —
  // which is the outline every guide on painting foliage says to carve away
  // from. Real foliage hangs off a branch: longer than it is deep, thickest
  // near the stem, ragged at the far end. Three or four sprays overlapping give
  // a lobe an edge the eye reads as leaves rather than as a circle.
  const stem = (rand() - 0.5) * 0.7;
  for (let i = 0; i < leaves; i++) {
    const b = boxes[(rand() * boxes.length) | 0];
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    // Along the spray's own axis, thinning toward its tip, with the leaves
    // hanging a little below it.
    const run = rand();
    const spread = (rand() - 0.5) * 2;
    const thick = (1 - run * 0.55) * 0.30;
    const ax = (run - 0.5) * 0.86;
    const ay = spread * thick + run * stem;
    const at = size * (0.5 + ax);
    const up = size * (0.46 + ay);
    const away = Math.hypot(ax, ay) * size;
    const scale = (size * 0.20 / Math.max(bw, bh)) * (0.55 + 0.55 * rand());
    cx.save();
    cx.translate(at, up);
    cx.rotate(rand() * Math.PI * 2);
    // Leaves at the back of a clump are in its shade, and a canopy with no
    // depth in it reads as a sticker whatever shape it is cut to.
    const shade = 0.5 + 0.5 * Math.min(1, away / (size * 0.4));
    cx.globalAlpha = 1;
    cx.filter = 'brightness(' + (1.15 - shade * 0.45).toFixed(3) + ')';
    cx.drawImage(src, b.x0, b.y0, bw, bh,
      -bw * scale / 2, -bh * scale / 2, bw * scale, bh * scale);
    cx.restore();
  }
  // <b>Feather the clump's rim.</b> A cluster with a hard edge is a slab
  // whatever is printed on it, and a canopy built from slabs is a pile of
  // boxes — which is exactly what thirty of them looked like. Fading the alpha
  // over the outer third lets one card dissolve into the next, so the crown
  // reads as one mass with depth in it rather than as its own construction.
  const shot = cx.getImageData(0, 0, size, size);
  const mid = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!shot.data[i + 3]) continue;
      // Feathered along the spray rather than in a circle, so the ends fade
      // and the middle stays solid.
      const ax = Math.abs(x - mid) / (size * 0.5);
      const ay = Math.abs(y - size * 0.46) / (size * 0.5);
      const away = Math.max(ax * 0.86, ay * 1.9);
      const keep = away < 0.66 ? 1 : Math.max(0, 1 - (away - 0.66) / 0.36);
      shot.data[i + 3] *= keep * keep;
    }
  }
  cx.putImageData(shot, 0, 0);
  return JSON.stringify({ png: cv.toDataURL('image/png').split(',')[1] });
}`;

const CUT = `async (colorB64, alphaB64, longest, spans_count) => {
  const load = b => new Promise((ok, no) => {
    const i = new Image();
    i.onload = () => ok(i); i.onerror = () => no(new Error('decode'));
    i.src = 'data:image/png;base64,' + b;
  });
  const colorImg = await load(colorB64);
  const alphaImg = alphaB64 ? await load(alphaB64) : null;
  const w = colorImg.naturalWidth, h = colorImg.naturalHeight;

  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(colorImg, 0, 0);
  const color = ctx.getImageData(0, 0, w, h);
  let opacity = null;
  if (alphaImg) {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(alphaImg, 0, 0, w, h);
    opacity = ctx.getImageData(0, 0, w, h);
  }

  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = opacity ? opacity.data[i * 4] : color.data[i * 4 + 3];
    solid[i] = a > 24 ? 1 : 0;
    out[i * 4] = color.data[i * 4];
    out[i * 4 + 1] = color.data[i * 4 + 1];
    out[i * 4 + 2] = color.data[i * 4 + 2];
    out[i * 4 + 3] = a;
  }

  let filled = solid.slice();
  for (let round = 0; round < 10; round++) {
    const grew = filled.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (!filled[j]) continue;
            r += out[j * 4]; g += out[j * 4 + 1]; b += out[j * 4 + 2]; c++;
          }
        }
        if (!c) continue;
        out[i * 4] = r / c; out[i * 4 + 1] = g / c; out[i * 4 + 2] = b / c;
        grew[i] = 1;
      }
    }
    filled = grew;
  }

  // Bounding boxes of the opaque blobs. Anything under a thousandth of the
  // sheet is scanner speckle, not a leaf.
  const seen = new Uint8Array(n);
  let boxes = [];
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (!solid[start] || seen[start]) continue;
    let top = 0; stack[top++] = start; seen[start] = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, count = 0;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i / w) | 0;
      count++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (solid[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
        }
      }
    }
    if (count > n / 1000) boxes.push({ x0, y0, x1: x1 + 1, y1: y1 + 1 });
  }

  // A scan often flakes a leaf into a blade and a detached tip. Merge boxes
  // that touch or nearly touch, repeatedly, until nothing more joins.
  const gap = Math.max(w, h) * 0.012;
  const near = (a, b) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap
    && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < boxes.length && !again; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (!near(boxes[i], boxes[j])) continue;
        boxes[i] = {
          x0: Math.min(boxes[i].x0, boxes[j].x0), y0: Math.min(boxes[i].y0, boxes[j].y0),
          x1: Math.max(boxes[i].x1, boxes[j].x1), y1: Math.max(boxes[i].y1, boxes[j].y1),
        };
        boxes.splice(j, 1); again = true; break;
      }
    }
  }
  boxes.sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));

  // Where the silhouette starts and stops at each of a few heights, as a
  // fraction of the cut-out's own width. Measured over a band rather than a
  // single scanline, because one row through a serrated leaf can fall in a
  // notch and pull the edge in across the whole card.
  const spansOf = (b) => {
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    const spans = [];
    for (let i = 0; i < spans_count; i++) {
      const centre = b.y0 + (bh * i) / (spans_count - 1);
      const from = Math.max(b.y0, Math.floor(centre - bh / (spans_count * 2)));
      const to = Math.min(b.y1 - 1, Math.ceil(centre + bh / (spans_count * 2)));
      let lo = w, hi = -1;
      for (let y = from; y <= to; y++) {
        for (let x = b.x0; x < b.x1; x++) {
          if (!solid[y * w + x]) continue;
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
      }
      spans.push(hi < lo
        ? [0.5, 0.5]
        : [(lo - b.x0) / bw, (hi + 1 - b.x0) / bw]);
    }
    return spans;
  };

  ctx.putImageData(new ImageData(out, w, h), 0, 0);
  const crops = boxes.map(b => {
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    const k = Math.min(1, longest / Math.max(bw, bh));
    const cw = Math.max(2, Math.round(bw * k)), ch = Math.max(2, Math.round(bh * k));
    const cc = document.createElement('canvas');
    cc.width = cw; cc.height = ch;
    const cx = cc.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(cv, b.x0, b.y0, bw, bh, 0, 0, cw, ch);
    // Bottom of the image first, because a card is built from its root up and
    // the root is the bottom of the scan.
    const spans = spansOf(b).reverse()
      .map(([l, r]) => [+l.toFixed(4), +r.toFixed(4)]);
    return {
      w: cw, h: ch, aspect: +(bw / bh).toFixed(4), spans,
      png: cc.toDataURL('image/png').split(',')[1],
    };
  });
  return JSON.stringify(crops);
}`;

const PACK = `(cropsJson, sheet) => {
  const crops = JSON.parse(cropsJson);
  const cv = document.createElement('canvas');
  cv.width = sheet; cv.height = sheet;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, sheet, sheet);
  // Shelf packing, tallest first. One pad pixel round every crop so a mip never
  // bleeds one leaf into the next.
  const pad = 2;
  const order = crops.map((c, i) => i).sort((a, b) => crops[b].h - crops[a].h);
  let x = pad, y = pad, shelf = 0;
  const placed = [];
  return (async () => {
    for (const i of order) {
      const c = crops[i];
      if (x + c.w + pad > sheet) { x = pad; y += shelf + pad; shelf = 0; }
      if (y + c.h + pad > sheet) return JSON.stringify({ error: 'sheet full' });
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = 'data:image/png;base64,' + c.png; });
      ctx.drawImage(img, x, y);
      placed[i] = {
        u0: +(x / sheet).toFixed(6), v0: +(y / sheet).toFixed(6),
        u1: +((x + c.w) / sheet).toFixed(6), v1: +((y + c.h) / sheet).toFixed(6),
        aspect: c.aspect, spans: c.spans,
      };
      x += c.w + pad;
      if (c.h > shelf) shelf = c.h;
    }
    return JSON.stringify({ png: cv.toDataURL('image/png').split(',')[1], placed });
  })();
}`;

const b64 = p => readFileSync(p).toString('base64');
mkdirSync(outDir, { recursive: true });

const all = [];
const groups = {};
for (const src of SOURCES) {
  const jobs = src.files
    ? src.files.map(f => ({ color: join(srcDir, f), opacity: null }))
    : [{
      color: join(srcDir, src.dir, `${src.stem}_Color.png`),
      opacity: join(srcDir, src.dir, `${src.stem}_Opacity.png`),
    }];
  for (const job of jobs) {
    if (!existsSync(job.color)) { console.error(`missing ${job.color}`); process.exit(1); }
    const crops = await call(CUT, [b64(job.color), job.opacity ? b64(job.opacity) : '', LONGEST, SPANS]);
    for (const crop of crops) {
      const name = src.group({ u0: 0, v0: 0, u1: crop.aspect, v1: 1 });
      (groups[name] ??= []).push(all.length);
      all.push(crop);
    }
    console.log(`${job.color.split('/').pop()}: ${crops.length}`);
  }
}

// The composed clumps go through the same cropping and measuring as anything
// cut from a scan — they are just a scan this tool made.
for (const clump of CLUMPS) {
  const stem = clump.stem;
  const color = join(srcDir, 'acg', clump.dir, `${stem}_Color.png`);
  const opacity = join(srcDir, 'acg', clump.dir, `${stem}_Opacity.png`);
  if (!existsSync(color)) { console.error(`missing ${color}`); process.exit(1); }
  for (let seed = 1; seed <= clump.seeds; seed++) {
    const made = await call(CLUMP, [
      b64(color), existsSync(opacity) ? b64(opacity) : '', clump.leaves, seed, 512,
    ]);
    if (made.error) { console.error(clump.dir, made.error); process.exit(1); }
    const crops = await call(CUT, [made.png, '', LONGEST, SPANS]);
    for (const crop of crops) {
      (groups[clump.group] ??= []).push(all.length);
      all.push(crop);
    }
  }
  console.log(`${clump.group} from ${clump.dir}: ${clump.seeds}`);
}

const packed = await call(PACK, [JSON.stringify(all), SHEET]);
if (packed.error) { console.error(packed.error); process.exit(1); }
const png = Buffer.from(packed.png, 'base64');
writeFileSync(join(outDir, 'foliage.png'), png);
writeFileSync(join(outDir, 'foliage.json'), JSON.stringify({
  sheet: SHEET,
  groups: Object.fromEntries(Object.entries(groups)
    .map(([name, ids]) => [name, ids.map(i => packed.placed[i])])),
}, null, 2));
for (const [name, ids] of Object.entries(groups)) {
  console.log(`${name}: ${ids.length}`);
}
console.log(`foliage.png ${(png.length / 1024) | 0} kB`);
ws.close();
