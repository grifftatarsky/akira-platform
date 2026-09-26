import { readFileSync, readdirSync } from 'node:fs';
import { withNativeFederation, share } from '@angular-architects/native-federation/config';

// ---- an explicit share list, not shareAll ----------------------------------
//
// shareAll leans on ignoreUnusedDeps, which finds the used packages by parsing
// every file reachable from every deep import with the TypeScript parser, and
// starts over for each one. The board deep-imports hundreds of @babylonjs/core
// modules, so that scan alone took 14.5 s of a 27 s build, only to conclude
// that none of Babylon is shared. Naming the packages skips the scan and
// publishes the same remoteEntry.json.
//
// rxjs/operators is not imported here; @angular/common/http and the router use
// it, and the scan used to add it for them.
const SHARED = [
  '@angular/common',
  '@angular/common/http',
  '@angular/forms',
  '@angular/platform-browser',
  '@angular/router',
  'rxjs',
  'rxjs/operators',
  'tslib',
];

// The scan also picked up new imports by itself. Without it, an Angular or rxjs
// entry point missing from the list would be bundled into ooze as a private
// copy instead, so fail the build and say which. (@angular/core is shared
// whole, below.)
const src = new URL('./src/', import.meta.url);
const unshared = new Set();
for (const file of readdirSync(src, { recursive: true })) {
  if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) {
    continue;
  }
  const code = readFileSync(new URL(file, src), 'utf8');
  for (const [, spec] of code.matchAll(/(?:from|import)\s*\(?\s*'((?:@angular\/|rxjs)[^']*)'/g)) {
    if (!SHARED.includes(spec) && spec !== '@angular/core' && !spec.startsWith('@angular/core/')) {
      unshared.add(spec);
    }
  }
}
if (unshared.size > 0) {
  throw new Error(`ooze imports ${[...unshared].join(', ')}, which projects/ooze/federation.config.mjs does not share. Add it to SHARED.`);
}

const singleton = { singleton: true, strictVersion: true, requiredVersion: 'auto', build: 'package' };

export default withNativeFederation({
  name: 'ooze',

  exposes: {
    './routes': './projects/ooze/src/app/ooze.routes.ts',
  },

  shared: share({
    ...Object.fromEntries(SHARED.map(name => [name, { ...singleton, includeSecondaries: false }])),
    // All of @angular/core, so its primitives never mismatch the host's.
    '@angular/core': { ...singleton, includeSecondaries: { keepAll: true } },
  }),

  skip: [
    'rxjs/ajax',
    'rxjs/fetch',
    'rxjs/testing',
    'rxjs/webSocket',

    // ---- three, bundled rather than shared ------------------------------
    //
    // three is a single package with zero runtime dependencies, so on its own
    // it has none of the diamond that broke the globe (see
    // jpss-ui/federation.config.mjs). Its *addons* are the trap: everything
    // under three/addons — OrbitControls, loaders, post-processing — imports
    // from 'three' itself. Shared, three becomes a self-contained chunk while
    // any bundled addon gets its own copy, and the two disagree about which
    // class is which. An OrbitControls that fails `instanceof Camera` is the
    // same failure as the ShaderAssembler, one step removed, and it appears
    // only at runtime from a perfectly green build.
    //
    // Skipping puts three and its addons through esbuild together, where they
    // are deduplicated the ordinary way: one three, one set of classes.
    'three',
  ],

  // Please read our FAQ about sharing libs:
  // https://shorturl.at/jmzH0

  features: {
    // The share list above is explicit; see there.
    ignoreUnusedDeps: false,

    // Opt-in: groups chunks in remoteEntry.json for smaller metadata file
    denseChunking: true
  }
});
