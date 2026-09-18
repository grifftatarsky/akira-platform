/**
 * Where this remote's own files actually are.
 *
 * <p>Served on its own, ooze is at `/` and its assets at `/assets/…`; inside
 * the host it is at `/ooze/…` and its assets at `/remotes/ooze/assets/…`. A
 * path relative to the document is right in exactly one of those, and the
 * failure is invisible — nginx answers a miss with `index.html`, 200,
 * `text/html`, so an image loader gets a web page and a texture silently
 * stays blank.
 *
 * <p>`import.meta.url` points at the chunk this code was loaded from, which
 * sits under the remote's own base in both shells.
 */
export function assetUrl(path: string): string {
  return new URL(path, import.meta.url).href;
}

/**
 * <p><b>And never run `ng serve` for a remote while the host is being served
 * from `dist`.</b> The dev server writes development chunks into that same
 * `dist`, the host is a production build, and the two disagree about
 * `ngDevMode` — which surfaces as `ReferenceError: ngDevMode is not defined`
 * thrown from the *host's* shared Angular router chunk, nowhere near the remote
 * that caused it. The whole of ooze goes blank. `rm -rf dist/ooze` and rebuild.
 */
