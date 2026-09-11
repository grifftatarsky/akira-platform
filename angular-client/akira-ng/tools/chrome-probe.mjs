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
// <b>Collect the console.</b> A WGSL shader that fails validation is reported
// by the browser as a warning and by Babylon as nothing at all: no exception,
// a material that still answers isReady, and a field with no grass in it. Not
// collecting this cost hours of bisecting a shader that was never running.
const logs = [];
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
    logs.push(`[${msg.params.type}] ${text}`.slice(0, 4000));
  }
  if (msg.method === 'Log.entryAdded') {
    logs.push(`[${msg.params.entry.level}] ${msg.params.entry.text}`.slice(0, 4000));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (msg.params.exceptionDetails.exception?.description ?? '').slice(0, 2000));
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
await send('Log.enable');
// <b>Make the page think it is looked at.</b> Chrome stops firing
// requestAnimationFrame for an occluded window, and Babylon's render loop is
// requestAnimationFrame - so a Chrome sitting behind a terminal reports a
// healthy fps from its last live second, a stale camera, and a GPU timer of
// zero. That reads exactly like a renderer that has broken. These make the
// throttling go away.
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.setWebLifecycleState', { state: 'active' });
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

if (process.env.SHOW_LOGS) {
  // <b>The root cause, not the cascade.</b> One bad shader produces hundreds of
  // "invalid pipeline due to a previous error" lines, and the one line that
  // names the actual fault is the first of them. Pulling the parse errors out
  // first is the difference between reading forty lines of noise and reading
  // "mixing '*' and '^' requires parenthesis".
  const root = logs.filter(l => /Error while parsing|error:|Unable to compile|exception|ReferenceError|TypeError/i.test(l));
  const seen = new Set();
  const unique = root.filter(l => {
    const key = l.replace(/\[Frame \d+\]|\(\d+\)|\[\d+\|\d+\]/g, '');
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
  console.error(`--- console: ${logs.length} lines, ${unique.length} distinct faults ---`);
  if (!unique.length) { console.error('(no shader or script faults)'); }
  unique.slice(0, Number(process.env.SHOW_LOGS) || 12).forEach(l => console.error(l.trim()));
}

if (shot) {
  // `fromSurface: false` captures from the renderer rather than the window's
  // own surface, which is the only path that works when the Chrome window is
  // behind something else. With the default the canvas comes back blank and
  // the page looks broken when it is fine.
  const res = await send('Page.captureScreenshot', {
    format: 'png', fromSurface: false, captureBeyondViewport: false,
  });
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
