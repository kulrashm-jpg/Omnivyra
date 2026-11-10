/**
 * Portable access to the Omnivyra Chrome extension source for tests.
 *
 * The extension is NOT in this repository (and is deliberately not vendored:
 * its licence/provenance is not recorded here). Tests that assert on its
 * source read it from the directory named by OMNIVYRA_EXTENSION_ROOT — the
 * extension root, i.e. the directory that contains `manifest.json`,
 * `core/` and `background/`. Windows (`C:\...\extension`) and POSIX
 * (`/home/me/omnivyra-ext/extension`) values both work: files are resolved
 * with path.join, never with hard-coded separators.
 *
 * When OMNIVYRA_EXTENSION_ROOT is unset/blank, ONLY the describe blocks that
 * need the external source are registered with describe.skip (so jest reports
 * every such test as SKIPPED, never passed) and a loud warning names the
 * variable. A root that IS set but does not exist, or lacks a required file, is
 * a configuration error and FAILS the suite instead of skipping.
 */
import fs from 'fs';
import path from 'path';

export const EXTENSION_ROOT_ENV = 'OMNIVYRA_EXTENSION_ROOT';

type PathImpl = Pick<typeof path, 'join' | 'resolve' | 'isAbsolute'>;

export type ExtensionRootResolution =
  | { ok: true; root: string }
  | { ok: false; reason: string };

/** Resolve the extension root from the environment (no filesystem access). */
export function resolveExtensionRoot(
  env: Record<string, string | undefined> = process.env,
  pathImpl: PathImpl = path,
): ExtensionRootResolution {
  const raw = (env[EXTENSION_ROOT_ENV] ?? '').trim();
  if (!raw) {
    return {
      ok: false,
      reason:
        `${EXTENSION_ROOT_ENV} is not set — the Chrome extension source is not in this repo, ` +
        'so assertions on it are SKIPPED (not passed). Set it to the extension root ' +
        '(the directory containing manifest.json) to run them.',
    };
  }
  return { ok: true, root: pathImpl.isAbsolute(raw) ? raw : pathImpl.resolve(raw) };
}

/** Join an extension-relative file (given as segments) onto the root. */
export function extensionFilePath(root: string, segments: string[], pathImpl: PathImpl = path): string {
  for (const s of segments) {
    if (s.includes('/') || s.includes('\\')) {
      throw new Error(`extension path segment must not contain a separator: ${JSON.stringify(s)}`);
    }
  }
  return pathImpl.join(root, ...segments);
}

/** Required files (as segments) that do not exist under `root`, as full paths. */
export function missingExtensionFiles(root: string, required: string[][]): string[] {
  if (!fs.existsSync(root)) return [root];
  return required.map((segs) => extensionFilePath(root, segs)).filter((p) => !fs.existsSync(p));
}

export type ExtensionSource = {
  root: string;
  /** Read an extension file by segments, e.g. read('core', 'apiClient.js'). */
  read: (...segments: string[]) => string;
};

/**
 * describe() whose tests need the extension source. `required` lists every
 * file the block reads; they are checked up front when the root is set.
 * Inside `body`, read files lazily (in beforeAll / it), never at registration.
 */
export function describeWithExtensionSource(
  title: string,
  required: string[][],
  body: (ext: ExtensionSource) => void,
  env: Record<string, string | undefined> = process.env,
): void {
  const resolved = resolveExtensionRoot(env);
  if (resolved.ok === false) {
    // eslint-disable-next-line no-console
    console.warn(`[extension-source] SKIPPING "${title}": ${resolved.reason}`);
    describe.skip(`${title} [SKIPPED: ${EXTENSION_ROOT_ENV} not set]`, () => {
      body({
        root: '',
        read: () => {
          throw new Error(`extension source unavailable: ${resolved.reason}`);
        },
      });
    });
    return;
  }
  const root = resolved.root;
  describe(title, () => {
    it(`${EXTENSION_ROOT_ENV} points at an extension root with every required file`, () => {
      expect(missingExtensionFiles(root, required)).toEqual([]);
    });
    body({ root, read: (...segments: string[]) => fs.readFileSync(extensionFilePath(root, segments), 'utf8') });
  });
}
