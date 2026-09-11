// Catch the three WGSL mistakes this project keeps making, before the GPU does.
//
// All three fail silently: Babylon reports nothing, the material still answers
// isReady(), the pipeline is quietly invalid and the field draws nothing. Each
// one has cost an hour at least once.
//
// Usage: node tools/wgsl-lint.mjs <file...>
import { readFileSync } from 'node:fs';

// WGSL builtins a local name must not shadow — shadowing turns that builtin's
// next call into "cannot use 'let x' as call target".
const BUILTINS = new Set([
  'step', 'mix', 'clamp', 'min', 'max', 'abs', 'floor', 'ceil', 'fract',
  'sin', 'cos', 'tan', 'pow', 'exp', 'log', 'sqrt', 'length', 'normalize',
  'dot', 'cross', 'distance', 'select', 'smoothstep', 'sign', 'round',
  'reflect', 'refract', 'saturate', 'atan2', 'modf', 'transpose',
]);

let bad = 0;
for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, 'utf8');
  // Every WGSL block in the file, found by its delimiters rather than by
  // matching balanced backticks — because a stray backtick inside the shader is
  // exactly the fault being looked for, and it breaks any regex that assumes
  // the pair is balanced. That is how this check missed the sixth occurrence of
  // the bug it exists to catch.
  const blocks = [];
  // Anchored to the line start so prose inside a JS comment cannot open a
  // block: "does not work: `vertexInputs.uv`" matched before this was.
  const opener = /^[ \t]*(?:(?:export )?const \w+\s*=|\w+:)\s*`/gm;
  for (let open = opener.exec(source); open; open = opener.exec(source)) {
    const from = open.index + open[0].length;
    const close = source.indexOf('`;', from);
    const fence = source.indexOf('`,', from);
    const to = close === -1 ? fence : (fence === -1 ? close : Math.min(close, fence));
    if (to === -1) { continue; }
    const body = source.slice(from, to);
    if (!/@compute|@vertex|@fragment|fn main|positionUpdated|vertexOutputs/.test(body)) { continue; }
    blocks.push({ body, at: source.slice(0, from).split('\n').length });
    opener.lastIndex = to;
  }

  for (const { body, at } of blocks) {
    const declared = [...body.matchAll(/^[ \t]*(?:let|var)[ \t]+(\w+)/gm)].map(m => m[1]);
    const seen = new Set();
    for (const name of declared) {
      if (BUILTINS.has(name)) { console.error(`${file}:~${at}  shadows WGSL builtin: ${name}`); bad++; }
      if (seen.has(name)) { console.error(`${file}:~${at}  redeclared in one scope: ${name}`); bad++; }
      seen.add(name);
    }
    // Mixed * and ^ without parentheses is a parse error, not a precedence
    // rule. Checked per statement with every parenthesised group stripped, so
    // only a genuinely top-level mix is flagged: `h ^= a; h *= b;` is two
    // statements, and `(a * b) ^ (c * d)` is already correct.
    const stripped = body.replace(/\/\/[^\n]*/g, '');
    for (const statement of stripped.split(';')) {
      let bare = statement;
      for (let pass = 0; pass < 20; pass++) {
        const next = bare.replace(/\([^()]*\)/g, ' ');
        if (next === bare) { break; }
        bare = next;
      }
      if (/[^*]\*[^*=]/.test(bare) && /\^/.test(bare)) {
        console.error(`${file}:~${at}  mixes '*' and '^' unparenthesised: ${statement.trim().replace(/\s+/g, ' ').slice(0, 70)}`);
        bad++;
      }
    }
  }
  // A backtick inside a WGSL comment closes the template literal. Five times now.
  for (const { body, at } of blocks) {
    if (body.includes('`')) { console.error(`${file}:~${at}  backtick inside the shader body`); bad++; }
  }
}
console.log(bad ? `${bad} problem(s)` : 'wgsl clean');
process.exit(bad ? 1 : 0);
