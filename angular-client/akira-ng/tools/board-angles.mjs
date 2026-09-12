// Shoot the board from a fixed set of angles, and time each one.
//
// <b>One screenshot is not a review.</b> Every foliage mistake this renderer
// has made was invisible from the angle it happened to be photographed at and
// obvious from another: a flat flower head is perfect from directly above and a
// white hyphen from low down; a leaned clover reads from one side and stands on
// its edge from the other; the card that clipped its own texture looked like a
// texture bug at every angle but the one that showed the quad.
//
// So the camera is swept rather than posed, the same sweep every time, and the
// frame time is read at each stop — because the expensive angle and the ugly
// angle are rarely the same one.
//
// Usage:
//   node tools/board-angles.mjs <out-dir> [url]
// Environment:
//   CDP_PORT (default 9333), SETTLE (first-load wait, default 34000)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.CDP_PORT || 9333;
const out = process.argv[2] || 'board-angles';
const url = process.argv[3] || 'http://localhost:4300/board/bab';
const settle = Number(process.env.SETTLE || 34000);

/**
 * Where to stand. Beta is from straight up, so 0.2 is nearly overhead and 1.45
 * is nearly level with the ground; radius is in half-feet.
 *
 * <p>These are the angles this board is actually used at plus the two it fails
 * at. `overhead` is the map view. `play` is where the camera sits most of the
 * time. `grazing` is the one that turns a horizontal card into a line.
 * `eye` is standing in the field, which is not the display but is where a
 * silhouette can be read.
 */
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
// Chrome stops firing requestAnimationFrame for a window it thinks is hidden,
// and Babylon's loop is requestAnimationFrame — a Chrome behind a terminal
// reports a stale camera and a frame time of zero.
// <b>And make it fetch the code, not remember it.</b> The dev server can be
// serving a current bundle while the browser still runs the chunk it cached
// before the edit — so a probe reports the old values, a screenshot shows the
// old board, and the fix that is already correct looks like it failed. That
// cost an hour on top of the hour the stale *server* bundle cost.
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
      // Wall clock between presents: the only honest frame time here. Every
      // engine counter on this board has measured something else.
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
      return {
        ms: +gaps[gaps.length >> 1].toFixed(2),
        worst: +gaps[Math.floor(gaps.length * 0.95)].toFixed(2),
        draws: st.scene.getEngine()._drawCalls ? undefined : undefined,
        tris: Math.round(tris),
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
}
writeFileSync(join(out, 'timings.json'), JSON.stringify(timings, null, 1));
if (faults.length) {
  console.error('--- exceptions ---');
  [...new Set(faults)].slice(0, 6).forEach(f => console.error(f));
}
console.log('shots in', out);
ws.close();
