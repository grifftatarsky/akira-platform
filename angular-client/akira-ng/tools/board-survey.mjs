import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.CDP_PORT || 9333;
const OUT = process.env.SURVEY_OUT || 'survey';
const COLS = Number(process.env.SURVEY_COLS || 4);
const ROWS = Number(process.env.SURVEY_ROWS || 2);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.filter(t => t.type === 'page').find(t => t.url.includes('board/bab'));
if (!page) { console.error('no board tab'); process.exit(1); }

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
const run = async (expression) => {
  const got = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (got.result.exceptionDetails) {
    throw new Error(got.result.exceptionDetails.exception?.description
      ?? got.result.exceptionDetails.text);
  }
  return got.result.result.value;
};

await send('Runtime.enable');
await run(`
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60 && !window.bab; i++) await wait(1000);
  window.bab.stage.scene.getEngine().setHardwareScalingLevel(0.5);
  await wait(3000);
  return true;
`);

const grid = await run(`
  const b = window.bab;
  const f = b.field;
  const cols = ${COLS * 12}, rows = ${ROWS * 12};
  const per = {};
  for (const sown of b.meadow.sown) {
    const raw = await sown.matrices.read();
    const m = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const bins = new Int32Array(cols * rows);
    for (let i = 0; i < sown.count; i++) {
      const o = i * 16;
      if (Math.abs(m[o+4]) + Math.abs(m[o+5]) + Math.abs(m[o+6]) < 1e-5) continue;
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(m[o+12] / f.extentXHalfFeet * cols)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(m[o+14] / f.extentYHalfFeet * rows)));
      bins[cy * cols + cx] += 1;
    }
    per[sown.plant.id] = Array.from(bins);
  }
  return { cols, rows, per,
    extent: [f.extentXHalfFeet, f.extentYHalfFeet] };
`);

const { cols, rows, per, extent } = grid;
const ids = Object.keys(per);
const total = new Int32Array(cols * rows);
for (const id of ids) per[id].forEach((v, i) => { total[i] += v; });

const cellArea = (extent[0] / cols) * (extent[1] / rows);
const dens = Array.from(total, v => v / cellArea);
const sorted = [...dens].sort((a, b) => a - b);
const median = sorted[sorted.length >> 1];
const bare = dens.map((v, i) => ({ v, i })).filter(x => x.v < median * 0.35);

console.log(`board ${extent[0]} x ${extent[1]} half-feet, ${cols} x ${rows} bins`);
console.log(`plants per square half-foot: median ${median.toFixed(2)}, min ${sorted[0].toFixed(2)}, max ${sorted[sorted.length-1].toFixed(2)}`);
console.log(`bins under 35% of median: ${bare.length} of ${cols*rows}`);
for (const id of ids) {
  const b2 = per[id];
  const empty = b2.filter(v => v === 0).length;
  console.log(`  ${id.padEnd(9)} total ${String(b2.reduce((a,c)=>a+c,0)).padStart(7)}  empty bins ${empty}`);
}
const ramp = ' .:-=+*#%@';
console.log('\ndensity map (@ densest, space = empty), x across, y down:');
const peak = sorted[sorted.length - 1] || 1;
for (let y = 0; y < rows; y++) {
  let line = '';
  for (let x = 0; x < cols; x++) {
    const v = dens[y * cols + x] / peak;
    line += ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
  }
  console.log('  ' + line);
}
console.log('\nper-species maps:');
for (const id of ids) {
  const b2 = per[id];
  const top = Math.max(...b2) || 1;
  console.log(`  ${id}:`);
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      line += ramp[Math.min(ramp.length - 1, Math.floor(b2[y * cols + x] / top * ramp.length))];
    }
    console.log('    ' + line);
  }
}

mkdirSync(OUT, { recursive: true });
const tiles = await run(`
  const b = window.bab, c = b.stage.scene.activeCamera;
  const f = b.field;
  const V = c.target.constructor;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const out = [];
  const cols = ${COLS}, rows = ${ROWS};
  const wide = f.extentXHalfFeet / cols, deep = f.extentYHalfFeet / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const atX = (x + 0.5) * wide, atY = (y + 0.5) * deep;
      c.setTarget(new V(atX, 0, atY));
      c.alpha = -Math.PI / 2; c.beta = 0.02;
      c.radius = Math.max(wide, deep) * 1.25;
      await wait(900);
      out.push({ x, y, at: [Math.round(atX), Math.round(atY)], png: await b.shot(760) });
    }
  }
  return out;
`);
for (const t of tiles) {
  writeFileSync(join(OUT, `tile-${t.y}-${t.x}.png`),
    Buffer.from(t.png.split(',')[1], 'base64'));
}
console.log(`\n${tiles.length} top-down tiles written to ${OUT}/`);
ws.close();
