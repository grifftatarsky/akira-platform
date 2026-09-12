// Measure where each cut-out's photographed stalk ends, and record it.
//
// <b>Silhouette width cannot answer this and it was tried.</b> A clover's
// petiole runs up the middle *between* the two lower leaflets, so the moment
// the leaflets appear the cut is full width while the stalk still has half its
// length to go. Trimming on width left a stub of stalk on the card, the drawn
// stem ran into it, and the leaf had two stems.
//
// What separates them is coverage, not extent: a row of stalk is two per cent
// alpha and a row of leaf is eighty. The first row reaching four fifths of the
// cut's own peak coverage is its junction, measured against all three clover
// scans and both wrong on width.
//
// Alpha lives in the PNG, and Node has no PNG decoder, so this borrows the
// same headless Chrome the packer does.
//
// Usage:  node tools/foliage-trim.mjs            (writes foliage.json in place)
//         CDP_PORT=9333 node tools/foliage-trim.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9333;
const SHEET = 'projects/ooze/public/assets/board/foliage/foliage.png';
const TABLE = 'projects/ooze/public/assets/board/foliage/foliage.json';
/** Of the cut's own peak coverage. Below this a row is stalk, not leaf. */
const JUNCTION = 0.8;
/** Rows sampled up each cut. Finer than the thirteen spans, because this is a
 *  one-off and the answer is a single number rather than an outline. */
const ROWS = 40;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find(t => t.type === 'page');
if (!page) { console.error('no page target; start Chrome with --remote-debugging-port'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let next = 1;
const waiting = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
const send = (method, params = {}) => new Promise(resolve => {
  const id = next++;
  waiting.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

const table = JSON.parse(readFileSync(TABLE, 'utf8'));
const png = readFileSync(SHEET).toString('base64');

const script = `(async () => {
  const img = new Image();
  img.src = 'data:image/png;base64,${png}';
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, img.width, img.height).data;
  const cuts = ${JSON.stringify(
    Object.entries(table.groups).flatMap(([group, list]) =>
      list.map((cut, at) => ({ group, at, u0: cut.u0, v0: cut.v0, u1: cut.u1, v1: cut.v1 }))))};
  return cuts.map(cut => {
    const x0 = Math.round(cut.u0 * img.width), x1 = Math.round(cut.u1 * img.width);
    const y0 = Math.round(cut.v0 * img.height), y1 = Math.round(cut.v1 * img.height);
    const cover = [];
    for (let r = 0; r < ${ROWS}; r++) {
      // The card's t=0 is the root, which is the bottom of the cut in image
      // space — v grows downward in the table.
      const ya = Math.round(y1 - (y1 - y0) * (r + 1) / ${ROWS});
      const yb = Math.round(y1 - (y1 - y0) * r / ${ROWS});
      let on = 0, all = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = x0; x < x1; x++) { all++; if (px[(y * img.width + x) * 4 + 3] > 127) on++; }
      }
      cover.push(all ? on / all : 0);
    }
    const most = Math.max(...cover);
    const row = cover.findIndex(v => v >= most * ${JUNCTION});
    return { group: cut.group, at: cut.at, stalk: row <= 0 ? 0 : +(row / ${ROWS}).toFixed(3) };
  });
})()`;

const res = await send('Runtime.evaluate', {
  expression: script, awaitPromise: true, returnByValue: true,
});
ws.close();
const found = res.result?.result?.value;
if (!Array.isArray(found)) {
  console.error('measurement failed:', JSON.stringify(res.result).slice(0, 400));
  process.exit(1);
}
for (const { group, at, stalk } of found) {
  table.groups[group][at].stalk = stalk;
}
writeFileSync(TABLE, JSON.stringify(table));
for (const group of Object.keys(table.groups)) {
  console.log(group, table.groups[group].map(c => c.stalk).join(' '));
}
