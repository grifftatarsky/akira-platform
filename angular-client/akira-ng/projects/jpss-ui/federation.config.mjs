import { withNativeFederation, shareAll } from '@angular-architects/native-federation/config';

export default withNativeFederation({
  name: 'jpss-ui',

  exposes: {
    './routes': './projects/jpss-ui/src/app/jpss.routes.ts',
  },

  // Every tsconfig path is a shared mapping unless this says otherwise, and the
  // only one, @ooze/contract, belongs to the host and ooze. Left at the default,
  // every build of this remote warns that no shared mapping is reachable.
  sharedMappings: [],

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

    // ---- the globe stack, bundled rather than shared --------------------
    //
    // Native Federation builds every shared package into its own *self-contained*
    // chunk: it does not externalise one shared package from inside another. So
    // a diamond gets duplicated, and the deck.gl graph is a diamond —
    // @deck.gl/core and @deck.gl/layers both sit on @luma.gl/engine and
    // @luma.gl/shadertools.
    //
    // Shared, each deck chunk therefore ships its own ShaderAssembler. deck.gl
    // registers its shader hooks (DECKGL_FILTER_COLOR and friends) on core's
    // singleton, and every layer's Model then compiles against layers'
    // singleton, which has none — so every fragment shader fails at runtime with
    // a build that was perfectly green. Declaring the luma packages as
    // dependencies does not fix this; it only adds chunks that nothing imports.
    //
    // Skipping puts the whole graph through esbuild instead, where it is
    // deduplicated the ordinary way: one luma, one assembler, one set of hooks.
    // These have to travel together, so they are skipped together.
    '@deck.gl/core',
    '@deck.gl/layers',
    '@deck.gl/maplibre',

    // The custom sticker layer imports Model, Geometry and Texture by name, so
    // these are real dependencies of this project and shareAll would otherwise
    // publish them. They belong to the same graph and must be bundled with it:
    // shared, @luma.gl/engine becomes a chunk that imports @luma.gl/shadertools,
    // which nothing publishes, and the remote fails to resolve on load.
    '@luma.gl/core',
    '@luma.gl/engine',

    // maplibre-gl renders with deck against one WebGL context, so it belongs in
    // the same bundle as the rest of that graph. (Under v5 there was a second
    // reason — it shipped UMD only, and a shared chunk exposed just `default`.
    // v6 is ESM-only, so that no longer applies; this one still does.)
    'maplibre-gl',
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
