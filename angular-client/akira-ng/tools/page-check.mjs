const PORT = process.env.CDP_PORT || 9333;
const url = process.argv[2];
const want = process.argv.slice(3);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.filter(t => t.type === 'page')
  .find(t => t.url.includes(url.replace(/^https?:\/\//, ''))) ?? null;
if (!page) { console.error(`no tab on ${url}`); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let next = 1;
const waiting = new Map();
const faults = [];
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    faults.push((msg.params.exceptionDetails.exception?.description
      ?? msg.params.exceptionDetails.text ?? '').slice(0, 300));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    faults.push((msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  }
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
const send = (method, params = {}) => new Promise(resolve => {
  const id = next++;
  waiting.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });
await new Promise(r => setTimeout(r, 2500));

const probe = `(() => {
  const text = document.body.innerText;
  return JSON.stringify({
    items: document.querySelectorAll('li.item').length,
    rows: document.querySelectorAll('tr').length,
    chars: text.length,
    missing: ${JSON.stringify(want)}.filter(w => !text.toLowerCase().includes(w.toLowerCase())),
  });
})()`;
const got = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
const out = JSON.parse(got.result.result.value ?? '{}');
ws.close();

const bad = [];
if (!out.items) bad.push('no plan items rendered');
if (out.chars < 2000) bad.push(`only ${out.chars} characters of text on the page`);
if (out.missing?.length) bad.push(`text missing: ${out.missing.join(' | ')}`);
if (faults.length) bad.push(`console errors: ${faults.slice(0, 3).join(' / ')}`);
console.log(`${url}: ${out.items} items, ${out.chars} chars`);
if (bad.length) { bad.forEach(b => console.error('  FAIL ' + b)); process.exit(1); }
console.log('  page renders');
