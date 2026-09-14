const PORT = process.env.CDP_PORT || 9333;
const url = process.argv[2];
const script = process.argv[3] || 'null';
const shot = process.argv[4];
const settle = Number(process.env.SETTLE || 15000);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = targets.filter(t => t.type === 'page');
const want = process.env.CDP_TAB
  ?? (url ? url.replace(/^https?:\/\//, '').split('?')[0] : '');
let page = pages.find(t => t.url.replace(/^https?:\/\//, '').startsWith(want)) ?? pages[0];
if (!page) { console.error('no page target'); process.exit(1); }
if (pages.length > 1) {
  console.error(`[probe] ${pages.length} tabs open, driving ${page.url}`);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let next = 1;
const waiting = new Map();
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
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
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

if (process.env.RAW_LOGS) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.RAW_LOGS, logs.join('\n'));
  console.error(`[probe] ${logs.length} console lines -> ${process.env.RAW_LOGS}`);
}
if (process.env.SHOW_LOGS) {
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
  const res = await send('Page.captureScreenshot', {
    format: 'png', fromSurface: false, captureBeyondViewport: false,
  });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(shot, Buffer.from(res.result.data, 'base64'));
  console.log('shot:', shot);
}
ws.close();
