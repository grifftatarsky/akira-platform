import { withNativeFederation, shareAll } from '@angular-architects/native-federation/config';

export default withNativeFederation({
  name: 'ooze',



  exposes: {
    './routes': './projects/ooze/src/app/ooze.routes.ts',
  },

  shared: {
    ...shareAll(
      { singleton: true, strictVersion: true, requiredVersion: 'auto', build: 'package' },
      {
        overrides: {
          // includeSecondaries is an opt-out of ignoreUnusedDeps, so all of
          // @angular/core is shared to prevent mismatches.
          '@angular/core': { singleton: true, strictVersion: true, requiredVersion: 'auto', build: 'package', includeSecondaries: { keepAll: true } },
        },
      },
    ),
  },

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
    // ignoreUnusedDeps is enabled by default now
    // ignoreUnusedDeps: true,

    // Opt-in: groups chunks in remoteEntry.json for smaller metadata file
    denseChunking: true
  }
});
