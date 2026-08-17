# stencil-hydrate-reuse-leak-repro

Repro for a memory leak found while reviewing [stenciljs/core#6794](https://github.com/stenciljs/core/pull/6794)
("feat(hydrate): cache platform closure and add opt-in window reuse").

The PR caches the hydrate platform closure on the `window` object and adds an opt-in
`reuseWindow` option to `renderToString()`/`hydrateDocument()` that reuses a process-global
`MockWindow` (one per `serializeShadowRoot` mode) across renders instead of creating a fresh
one each time.

Two independent unbounded-growth mechanisms were found:

1. **Window/document-targeted `@Listen` handlers accumulate forever.** Any component using
   `@Listen('event', { target: 'window' })` or `{ target: 'document' }` attaches a real
   listener to the reused window/document on every hydrate. `getReusableWindow`'s reset logic
   (swaps `<head>`/`<body>`, clears storage/cookies/location/navigator) never removes event
   listeners, and the window is never closed on the success path — so listeners pile up one per
   render, forever.
2. **The `reusableWindows` cache (keyed by `JSON.stringify(serializeShadowRoot)`) never evicts
   on success.** Any caller that varies `serializeShadowRoot` per call (e.g. a per-request
   scoped-tag array) mints a new permanently-retained window + platform closure every time.

## What's in here

- `src/components/leak-cmp/` — a shadow component with a window- and a document-targeted
  `@Listen`, to trigger leak #1.
- `src/components/plain-cmp/` — an identical shadow component with **no** listeners, used as a
  control to isolate leak #1 from general `reuseWindow` overhead.
- `leak-check.js` — calls `renderToString()` in a loop across 4 scenarios (A/B/C/D below),
  forcing GC (`--expose-gc`) and sampling `process.memoryUsage().heapUsed` between batches.
- `stencil.config.ts` — single `dist-hydrate-script` output target.

`package.json` points `@stencil/core` at `file:../stenciljs` — i.e. it expects a checkout of
[stenciljs/core](https://github.com/stenciljs/core) to live in a sibling directory named
`stenciljs` (adjust the path in `package.json` if yours lives elsewhere). This repo doesn't
vendor a build of `@stencil/core` itself, since the whole point is to test different
branches/commits of the compiler+runtime against the same fixture.

## Running it

1. Build the version of `@stencil/core` you want to test:

   ```sh
   cd ../stenciljs                          # or wherever your checkout lives
   gh pr checkout 6794                      # or: git checkout <branch/commit you want to test>
   npm ci                                   # if needed
   npm run build
   ```

2. Install and build this repro against that local build:

   ```sh
   cd ../stencil-hydrate-reuse-leak-repro
   npm install                              # picks up @stencil/core via file:../stenciljs
   npm run build                            # generates ./hydrate via dist-hydrate-script
   npm run leak-check                       # node --expose-gc leak-check.js
   ```

   Because `@stencil/core` is a `file:` dependency, npm copies it into `node_modules` at
   `npm install` time rather than symlinking — if you rebuild `stenciljs` (step 1) after
   already running `npm install` here, re-run `npm install` in this repo too (or
   `rm -rf node_modules/@stencil/core && npm install`) to pick up the new build before
   re-running `leak-check`.

Iteration counts are tunable via env vars if you want a longer/shorter run:
`ITERATIONS`, `D_ITERATIONS`, `SAMPLE_EVERY`, `D_SAMPLE_EVERY`, `WARMUP` (see top of
`leak-check.js`).

## Results from the original run (3000 iterations for A/B/C, 800 for D)

| Scenario | Config | heapUsed start → end | Rate |
|---|---|---|---|
| A (control) | `reuseWindow: false`, listener component | 7.44MB → 7.29MB | flat (noise) |
| B | `reuseWindow: true`, constant mode, listener component | 9.05MB → 31.80MB | **~8.1MB / 1000 renders, linear, never plateaus** |
| C (control) | `reuseWindow: true`, constant mode, no-listener component | 31.81MB → 32.36MB | flat (noise) |
| D | `reuseWindow: true`, `serializeShadowRoot` varies per call, no-listener component | 34.40MB → 67.49MB | **~44MB / 1000 renders, linear, never plateaus** |

A vs. B isolates leak #1 (identical component, only `reuseWindow` differs — B alone grows).
B vs. C isolates it further (both use `reuseWindow`, only the listeners differ — C stays flat).
D isolates leak #2 independently (same no-listener component as C, only `serializeShadowRoot`
varies — D grows ~200x faster than C).

Neither B nor D shows any sign of leveling off — that's the signature of an actual leak rather
than a one-time cache-warming cost (contrast with C, which jumps once during warmup and then
stays flat).
