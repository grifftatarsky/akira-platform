// Screenshot the board by rendering it into an offscreen target and reading
// the pixels back.
//
// `Page.captureScreenshot` cannot see a WebGPU canvas when the Chrome window is
// behind something else — not with `fromSurface`, not without it — so it comes
// back with the page chrome drawn and the canvas a clean white rectangle, which
// reads exactly like a renderer that has stopped working. This route never
// touches the compositor: Babylon renders the scene into a render target we
// own, hands the bytes back, and a 2D canvas turns them into a PNG.
//
// Usage: node tools/board-shot.mjs <out.png> ["<setup js>"]
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9333;
const out = process.argv[2];
const setup = process.argv[3] || '';
const width = Number(process.env.SHOT_W || 960);
const height = Number(process.env.SHOT_H || 460);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find(t => t.type === 'page');
if (!page) { console.error('no page target'); process.exit(1); }

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

await send('Runtime.enable');
// Without these the window being occluded stops requestAnimationFrame, and
// with it Babylon's whole render loop.
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.setWebLifecycleState', { state: 'active' });

const body = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const b = window.bab;
  if (!b) return 'NO_BOARD';
  ${setup}
  await wait(2500);
  const s = b.stage.scene;
  // The shadow map is a RenderTargetTexture, and its constructor is the only
  // handle on that class here: deep imports mean there is no global BABYLON.
  const RTT = b.stage.shadows.getShadowMap().constructor;
  const rtt = new RTT('probe-shot', { width: ${width}, height: ${height} }, s, false);
  rtt.renderList = null;
  rtt.activeCamera = s.activeCamera;
  s.customRenderTargets.push(rtt);
  await wait(1600);
  const px = await rtt.readPixels();
  s.customRenderTargets.splice(s.customRenderTargets.indexOf(rtt), 1);
  rtt.dispose();
  const cv = document.createElement('canvas');
  cv.width = ${width}; cv.height = ${height};
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(${width}, ${height});
  for (let y = 0; y < ${height}; y++) {
    const src = (${height} - 1 - y) * ${width} * 4, dst = y * ${width} * 4;
    for (let i = 0; i < ${width} * 4; i++) img.data[dst + i] = px[src + i];
    for (let x = 0; x < ${width}; x++) img.data[dst + x * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
})()`;

const res = await send('Runtime.evaluate', {
  expression: body, awaitPromise: true, returnByValue: true,
});
const value = res.result?.result?.value;
if (typeof value !== 'string' || !value.startsWith('data:image')) {
  console.error('shot failed:', JSON.stringify(res.result).slice(0, 600));
  process.exit(1);
}
writeFileSync(out, Buffer.from(value.split(',')[1], 'base64'));
console.log('wrote', out);
process.exit(0);
