// Drive a real headed Chrome over the DevTools protocol.
//
// The in-app browser pane cannot be trusted for WebGPU work: it logs
// "Destroyed texture [WebgpuSwapChainTexture] used in a submit" and renders a
// board that is correct on the user's own machine. This is a second opinion
// with a real GPU behind it.
const PORT = process.env.CDP_PORT || 9333;
const url = process.argv[2];
const script = process.argv[3] || 'null';
const shot = process.argv[4];
const settle = Number(process.env.SETTLE || 15000);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let page = targets.find(t => t.type === 'page');
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

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
if (url) {
  await send('Page.navigate', { url });
  await new Promise(r => setTimeout(r, settle));
}

if (script && script !== 'null') {
  const res = await send('Runtime.evaluate', {
    expression: `(async () => { ${script} })()`,
    awaitPromise: true, returnByValue: true,
  });
  console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 2));
}

if (shot) {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(shot, Buffer.from(res.result.data, 'base64'));
  console.log('shot:', shot);
}
ws.close();

/*
 * Usage:
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --remote-debugging-port=9333 --user-data-dir=/tmp/chrome-probe \
 *     --no-first-run --window-size=1500,950 about:blank &
 *   SETTLE=18000 node tools/chrome-probe.mjs <url> '<js returning a value>' [out.png]
 *
 * Why this exists: the in-app browser pane cannot render WebGPU reliably — it
 * logs "Destroyed texture [WebgpuSwapChainTexture] used in a submit" and draws
 * a board that is perfect on the same machine in a real Chrome. A whole
 * afternoon went into a bug that was only ever in the viewer. Measure here.
 */
