import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.CDP_PORT || 9333;
const out = process.argv[2] || 'board-angles';
const url = process.argv[3] || 'http://localhost:4300/board/bab';
const settle = Number(process.env.SETTLE || 34000);

const STOPS = [
  { name: 'overhead', alpha: -1.15, beta: 0.22, radius: 420 },
  { name: 'high', alpha: -1.15, beta: 0.62, radius: 360 },
  { name: 'play', alpha: -1.15, beta: 1.02, radius: 300 },
  { name: 'low', alpha: -1.15, beta: 1.32, radius: 240 },
  { name: 'grazing', alpha: -1.15, beta: 1.46, radius: 200 },
  { name: 'play-east', alpha: 0.45, beta: 1.02, radius: 300 },
  { name: 'play-north', alpha: -2.75, beta: 1.02, radius: 300 },
  { name: 'close', alpha: -1.0, beta: 1.18, radius: 70 },
  { name: 'ground', alpha: -1.0, beta: 1.42, radius: 26 },
];

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find(t => t.type === 'page');
if (!page) { console.error('no page target'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let next = 1;
const waiting = new Map();
const faults = [];
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    faults.push((msg.params.exceptionDetails.exception?.description ?? '').slice(0, 300));
  }
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
const send = (method, params = {}) => new Promise(resolve => {
  const id = next++;
  waiting.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');

await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.setWebLifecycleState', { state: 'active' });
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, settle));

mkdirSync(out, { recursive: true });
const timings = [];
for (const stop of STOPS) {
  const res = await send('Runtime.evaluate', {
    expression: `(async () => {
      const st = globalThis.bab && globalThis.bab.stage;
      if (!st) { return { error: 'no board' }; }
      const c = st.scene.activeCamera;
      c.alpha = ${stop.alpha}; c.beta = ${stop.beta}; c.radius = ${stop.radius};
      await new Promise(r => setTimeout(r, 2400));
      const gaps = [];
      await new Promise(done => {
        let seen = 0, last = performance.now();
        const tick = () => {
          const now = performance.now();
          if (seen++) { gaps.push(now - last); }
          last = now;
          if (seen <= 80) { requestAnimationFrame(tick); } else { done(); }
        };
        requestAnimationFrame(tick);
      });
      gaps.sort((a, b) => a - b);
      let tris = 0;
      for (const m of st.scene.meshes) {
        if (m.isEnabled() && m.isVisible) {
          tris += (m.getTotalIndices() / 3) * Math.max(1, m.thinInstanceCount || 1);
        }
      }
      const cost = globalThis.bab.cost ? globalThis.bab.cost() : null;
      return {
        ms: +gaps[gaps.length >> 1].toFixed(2),
        worst: +gaps[Math.floor(gaps.length * 0.95)].toFixed(2),
        tris: Math.round(tris),
        passes: cost ? cost.passes : [],
      };
    })()`,
    awaitPromise: true, returnByValue: true,
  });
  const value = res.result?.result?.value ?? {};
  timings.push({ stop: stop.name, ...stop, ...value });
  const shot = await send('Page.captureScreenshot', {
    format: 'png', fromSurface: false, captureBeyondViewport: false,
  });
  writeFileSync(join(out, `${stop.name}.png`), Buffer.from(shot.result.data, 'base64'));
  console.log(
    stop.name.padEnd(12),
    'beta', String(stop.beta).padEnd(5),
    'r', String(stop.radius).padEnd(5),
    (value.ms ?? '?') + ' ms', '  p95', (value.worst ?? '?') + ' ms',
    '  tris', (value.tris ?? '?').toLocaleString(),
  );
  for (const pass of value.passes ?? []) {
    console.log('   ', pass.name.padEnd(22), pass.ms + ' ms');
  }
}
writeFileSync(join(out, 'timings.json'), JSON.stringify(timings, null, 1));
if (faults.length) {
  console.error('--- exceptions ---');
  [...new Set(faults)].slice(0, 6).forEach(f => console.error(f));
}
console.log('shots in', out);
ws.close();
