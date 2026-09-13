// Catch the mistakes this project keeps making in template literals, before
// the GPU or the compiler does.
//
// All three fail silently: Babylon reports nothing, the material still answers
// isReady(), the pipeline is quietly invalid and the field draws nothing. Each
// one has cost an hour at least once.
//
// Usage: node tools/wgsl-lint.mjs <file...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// No arguments used to lint no files and report "wgsl clean", which is how a
// reserved-word fault reached a probe run with three green checks behind it.
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (/\.(ts|mts)$/.test(entry)) found.push(full);
  }
  return found;
}

// WGSL builtins a local name must not shadow — shadowing turns that builtin's
// next call into "cannot use 'let x' as call target".
const BUILTINS = new Set([
  'step', 'mix', 'clamp', 'min', 'max', 'abs', 'floor', 'ceil', 'fract',
  'sin', 'cos', 'tan', 'pow', 'exp', 'log', 'sqrt', 'length', 'normalize',
  'dot', 'cross', 'distance', 'select', 'smoothstep', 'sign', 'round',
  'reflect', 'refract', 'saturate', 'atan2', 'modf', 'transpose',
]);

// WGSL reserved words. A local named one of these fails to parse at pipeline
// creation as a *warning* — the material still answers isReady(), and the field
// simply has no grass in it. `patch` cost a full probe run.
const RESERVED = new Set([
  'active', 'alignas', 'alignof', 'as', 'asm', 'bf16', 'binding_array', 'cast',
  'catch', 'class', 'co_await', 'co_return', 'co_yield', 'coherent',
  'column_major', 'common', 'compile', 'compile_fragment', 'concept',
  'const_cast', 'consteval', 'constexpr', 'constinit', 'crate', 'debugger',
  'decltype', 'delete', 'demote', 'demote_to_helper', 'do', 'dynamic_cast',
  'enum', 'explicit', 'export', 'extends', 'extern', 'external', 'filter',
  'final', 'finally', 'friend', 'from', 'fxgroup', 'get', 'goto', 'groupshared',
  'highp', 'impl', 'implements', 'import', 'inline', 'instanceof', 'interface',
  'layout', 'lowp', 'macro', 'macro_rules', 'match', 'mediump', 'meta', 'mod',
  'module', 'move', 'mut', 'mutable', 'namespace', 'new', 'nil', 'noexcept',
  'noinline', 'nointerpolation', 'non_coherent', 'noncoherent', 'noperspective',
  'null', 'nullptr', 'of', 'operator', 'package', 'packoffset', 'partition',
  'pass', 'patch', 'pixelfragment', 'precise', 'precision', 'premerge',
  'priv', 'protected', 'pub', 'public', 'readonly', 'ref', 'regardless',
  'register', 'reinterpret_cast', 'require', 'resource', 'restrict',
  'self', 'set', 'shared', 'sizeof', 'smooth', 'snorm', 'static',
  'static_assert', 'static_cast', 'std', 'subroutine', 'super', 'target',
  'tempate', 'template', 'this', 'thread_local', 'throw', 'trait', 'try',
  'type', 'typedef', 'typeid', 'typename', 'typeof', 'union', 'unless',
  'unorm', 'unsafe', 'unsized', 'use', 'using', 'varying', 'virtual', 'volatile',
  'wgsl', 'where', 'with', 'writeonly', 'yield',
]);

let bad = 0;
const given = process.argv.slice(2);
const files = given.length ? given : walk('projects');
if (!given.length) console.log(`wgsl-lint: ${files.length} files under projects/`);
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  // Every WGSL block in the file, found by its delimiters rather than by
  // matching balanced backticks — because a stray backtick inside the shader is
  // exactly the fault being looked for, and it breaks any regex that assumes
  // the pair is balanced. That is how this check missed the sixth occurrence of
  // the bug it exists to catch.
  const blocks = [];
  const markup = [];
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
    const at = source.slice(0, from).split('\n').length;
    if (/@compute|@vertex|@fragment|fn main|positionUpdated|vertexOutputs/.test(body)) {
      blocks.push({ body, at });
    } else if (/<\w|@if |@for /.test(body)) {
      // An Angular component template. Not shader code, but it lives in the
      // same kind of literal and fails the same way.
      markup.push({ body, at });
    }
    opener.lastIndex = to;
  }

  for (const { body, at } of blocks) {
    const declared = [...body.matchAll(/^[ \t]*(?:let|var)[ \t]+(\w+)/gm)].map(m => m[1]);
    const seen = new Set();
    for (const name of declared) {
      if (BUILTINS.has(name)) { console.error(`${file}:~${at}  shadows WGSL builtin: ${name}`); bad++; }
      if (RESERVED.has(name)) { console.error(`${file}:~${at}  WGSL reserved word: ${name}`); bad++; }
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
  // <b>A backtick inside the body closes the template literal.</b> Eight times
  // now, and the eighth was not in a shader at all — it was prose inside an
  // HTML comment inside an Angular component's `template`, which fails exactly
  // the same way and was not being looked at. Both kinds of literal are checked
  // now; the fix is always to write the name without the quoting.
  for (const { body, at } of blocks) {
    if (body.includes('`')) { console.error(`${file}:~${at}  backtick inside the shader body`); bad++; }
  }
  for (const { body, at } of markup) {
    if (body.includes('`')) { console.error(`${file}:~${at}  backtick inside a component template`); bad++; }
  }
}
console.log(bad ? `${bad} problem(s)` : 'wgsl clean');
process.exit(bad ? 1 : 0);
