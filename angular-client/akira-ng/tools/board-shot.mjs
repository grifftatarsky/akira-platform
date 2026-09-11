// Screenshot the board by copying its live canvas into a 2D canvas.
//
// `Page.captureScreenshot` cannot see a WebGPU canvas when the Chrome window is
// behind something else — not with `fromSurface`, not without it — so it comes
// back with the page chrome drawn and the canvas a clean white rectangle, which
// reads exactly like a renderer that has stopped working.
//
// The first way round that rendered the scene into a render target of our own
// and read the pixels back. It worked and it lied by omission: a render target
// is not the camera, so nothing in the camera's post-process chain reaches it —
// no tone mapping, no temporal anti-aliasing, no ambient occlusion. Every
// screenshot showed the frame *before* the half of the pipeline that was being
// worked on.
//
// `drawImage` from the WebGPU canvas into a 2D one gives the composited frame,
// post-processes and all, and never asks the compositor for anything.
//
// Usage: node tools/board-shot.mjs <out.png> ["<setup js>"]
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9333;
const out = process.argv[2];
const setup = process.argv[3] || '';
const width = Number(process.env.SHOT_W || 960);

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
  const e = b.stage.scene.getEngine();
  const src = e.getRenderingCanvas();
  const cv = document.createElement('canvas');
  // Keep the canvas's own aspect so nothing is squashed.
  cv.width = ${width};
  cv.height = Math.round(${width} * src.height / src.width);
  const ctx = cv.getContext('2d');
  // <b>Two frames, then draw.</b> The first request lands mid-frame; the second
  // guarantees a complete presented image to copy. Without it the copy can
  // catch a half-drawn frame, which reads as a torn screenshot.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
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
