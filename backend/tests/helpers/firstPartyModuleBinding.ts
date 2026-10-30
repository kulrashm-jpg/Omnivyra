/**
 * FIRST-PARTY MODULE BINDING DETECTORS (PI WS-4B · TEST LAYER).
 *
 * WHY THIS EXISTS. A `pages/api` route is compiled by webpack (`next build
 * --webpack`, see `scripts/safe-build.js`), and webpack installs a module's
 * export bindings only for dependencies reached by `import`. A bare CommonJS
 * `require('../../../backend/services/...')` of a first-party ES module that
 * nothing else in that layer imports therefore linked to an exports object with
 * NO KEYS in production, while the SAME source ran perfectly under plain Node,
 * ts-jest and tsx. `owned-identities.ts` carried exactly that form, so
 * `loadRegistry().listActiveAttestedIdentities` was `undefined` at runtime and
 * every GET fell into the handler's catch as
 * `503 owned_identities_unavailable` — fail-closed, and therefore invisible.
 *
 * WHAT THESE FUNCTIONS ARE FOR, AND WHAT THEY ARE NOT. They are a STRUCTURAL
 * detector over source text: they answer "is the module reached by `import`, or
 * by a bare `require`". They are not a bundler. A test that calls a route
 * in-process cannot see this defect at all — that is the measured reason the
 * existing 151-assertion route suite passed before and after the fix — so the
 * form is pinned here, at the only layer that can observe it without running
 * webpack over Next's own internal configuration.
 *
 * THEY LIVE IN THE HELPER LAYER so the same detector code can be pointed at a
 * deliberately regressed copy of a route OUTSIDE the worktree. A detector that
 * has only ever been run against a passing file is a detector nobody has
 * tested; the suite that uses these proves them against the historical form
 * before trusting them on the current one.
 *
 * Nothing here reads a database, touches the network or imports product code.
 */
import path from 'path';

/**
 * A `require('<literal>')` call found in source text, with the specifier
 * resolved when it names a path rather than a package.
 */
export interface FirstPartyRequireCall {
  /** The specifier exactly as written. */
  readonly specifier: string;
  /** Absolute path the specifier names, extension-less, or `null`. */
  readonly resolved: string | null;
}

/** A top-level `import * as <local> from '<specifier>'`. */
export interface NamespaceImport {
  readonly local: string;
  readonly specifier: string;
}

/**
 * Comments are stripped before every detector runs, so a file's OWN PROSE
 * cannot satisfy or trip a check. This matters in both directions here: the
 * route's header legitimately quotes the broken `require(...)` form while
 * explaining why it is gone, and the fix's own comment names the namespace
 * import. Either would make a naive text match lie.
 *
 * The line-comment arm keeps the character before `//` so a `://` inside a URL
 * is not mistaken for a comment start — the same guard the structure section of
 * `piWs4bOwnedIdentityRoutes.test.ts` uses.
 */
export const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * Is this specifier first-party source rather than a package?
 *
 * Three forms, because all three reach the same tree: a relative path, the
 * `@/` root alias jest and tsconfig both map to the repository root, and a
 * bare top-level source directory. A package specifier (`next`, `fs`) is NOT
 * first-party: those are externals to the server build and are not what broke.
 */
export const isFirstPartySpecifier = (specifier: string): boolean =>
  /^\.{1,2}\//.test(specifier)
  || /^@\//.test(specifier)
  || /^(backend|shared|lib|pages|components|hooks|observability)\//.test(specifier);

/** Absolute path a first-party specifier names, or `null` if it names none. */
export function resolveFirstPartySpecifier(
  specifier: string,
  fileDir: string,
  repoRoot: string,
): string | null {
  if (/^\.{1,2}\//.test(specifier)) return path.resolve(fileDir, specifier);
  if (/^@\//.test(specifier)) return path.resolve(repoRoot, specifier.slice(2));
  if (isFirstPartySpecifier(specifier)) return path.resolve(repoRoot, specifier);
  return null;
}

/**
 * Every `require('<literal>')` of FIRST-PARTY source in the given file.
 *
 * Only a string-literal argument is matched, deliberately: a computed
 * `require(someVariable)` is a different and far louder problem — webpack warns
 * at build time and emits a context module — whereas the literal form is the
 * one that compiles silently and resolves to nothing. `import type` is not
 * matched because it emits no runtime binding at all.
 */
export function findFirstPartyRequires(
  source: string,
  options: { readonly fileDir: string; readonly repoRoot: string },
): FirstPartyRequireCall[] {
  const found: FirstPartyRequireCall[] = [];
  const pattern = /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
  let match = pattern.exec(source);
  while (match !== null) {
    const specifier = match[2];
    if (isFirstPartySpecifier(specifier)) {
      found.push({
        specifier,
        resolved: resolveFirstPartySpecifier(specifier, options.fileDir, options.repoRoot),
      });
    }
    match = pattern.exec(source);
  }
  return found;
}

/** Every `import * as <local> from '<specifier>'` in the given source. */
export function findNamespaceImports(source: string): NamespaceImport[] {
  const found: NamespaceImport[] = [];
  const pattern = /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"\n]+)\2/g;
  let match = pattern.exec(source);
  while (match !== null) {
    found.push({ local: match[1], specifier: match[3] });
    match = pattern.exec(source);
  }
  return found;
}

/**
 * Does the specifier name this module, whatever the relative prefix?
 *
 * Compared on the trailing path rather than the whole string so the assertion
 * survives the route moving a directory — the depth of `../../../` is not the
 * property under test.
 */
export const specifierNamesModule = (specifier: string, moduleSuffix: string): boolean =>
  specifier.replace(/\.(ts|tsx|js)$/, '').endsWith(moduleSuffix);

/**
 * The body of a top-level `function <name>(...)`, by brace balance.
 *
 * A regex cannot bound a function body, and the point of reading the body at
 * all is to say that the ONE function the bundler defect lived in resolves its
 * module by the linked binding. Returns `null` when the function is absent,
 * which the caller must treat as a failure rather than as an empty body — an
 * absent function is a renamed or deleted seam, not a passing check.
 */
export function extractFunctionBody(source: string, name: string): string | null {
  const signature = new RegExp(`\\bfunction\\s+${name}\\s*\\(`);
  const start = source.search(signature);
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}
