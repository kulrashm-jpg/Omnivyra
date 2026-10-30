/**
 * PI WS-4B — HOW the owned-identity route REACHES the attested-identity
 * repository, as the bundler sees it.
 *
 * THE DEFECT THIS SUITE EXISTS FOR, AND WHY EVERY OTHER TEST MISSED IT.
 * `pages/api/prospect-identity/owned-identities.ts` resolved the repository
 * with a bare CommonJS `require` inside `loadRegistry()`. Next compiles
 * `pages/api` with webpack (`next build --webpack`, see
 * `scripts/safe-build.js`), and webpack installs a module's export bindings
 * only for dependencies reached by `import`. Nothing else in that layer
 * imported the repository, so the `require` linked to an exports object with NO
 * KEYS AT ALL — measured in the deployed function as
 * `{"modType":"object","keys":"","hasEsModule":false,"listType":"undefined"}`.
 * `loadRegistry().listActiveAttestedIdentities` was therefore `undefined`, the
 * call threw `TypeError`, and `handleList`'s catch turned EVERY request into
 * `503 owned_identities_unavailable`. Fail-closed, and so invisible.
 *
 * Nothing in the test estate could see it:
 *
 *   · plain Node, ts-jest and tsx all populate that same `require`, so any
 *     in-process invocation of the route answers 200 whichever form is
 *     written. An execution test is not evidence here — it is the reason the
 *     defect shipped;
 *   · `piWs4bOwnedIdentityRoutes.test.ts` passes 151/151 before AND after the
 *     fix, because it replaces the whole registry PORT OBJECT through
 *     `__setOwnedIdentityRegistryPorts`, so `loadRegistry` never runs. Its
 *     port-contract section does restore the default binding, but under
 *     ts-jest — the one runtime in which both forms work.
 *
 * SO THIS SUITE CHECKS THE FORM, NOT THE BEHAVIOUR, and says so plainly. The
 * property is a BUILD-GRAPH property: "the repository is a dependency webpack
 * links", which is a statement about the source, not about a response. It is
 * pinned here because that is the only layer at which it is observable without
 * running `next build` — see the feasibility note at the end of this header.
 *
 * WHAT IS STRUCTURALLY CHECKED (this file):
 *   1. the repository is bound by a top-level `import * as` — the form that
 *      makes webpack link the module and populate its bindings;
 *   2. `loadRegistry()` returns THAT binding and contains no `require`;
 *   3. no bare `require()` of ANY first-party path survives anywhere in the
 *      route, so the defect cannot return via a different dependency;
 *   4. the member names the route's own `AttestedIdentityRepositoryModule`
 *      interface declares really are functions on the real module — a renamed
 *      export on either side is a binding that resolves to `undefined` just as
 *      surely as an unlinked one.
 *
 * WHAT REMAINS COVERED ONLY BY THE LIVE HTTP SMOKE TEST: that the ASSEMBLED
 * production bundle answers `200` on
 * `GET /api/prospect-identity/owned-identities`. No source-shape check can
 * establish that, because the binding is installed by Next's own webpack
 * configuration (`next-swc-loader`, the server externals in `next.config.js`,
 * the pages-api entry wrapper and the whole-graph `providedExports` /
 * `usedExports` analysis). A hand-built webpack compile was attempted and
 * REJECTED as a gate: webpack 5.98 — the copy Next vendors — linked the bare
 * `require` correctly in every configuration tried (mode `none`; mode
 * `production` with `usedExports`/`providedExports`/`sideEffects`; and over
 * Next's own SWC output), so a test built on it would have passed on the
 * REGRESSED source too. A gate that cannot fail is worse than no gate, and
 * reproducing the defect means reproducing Next's internal configuration, which
 * means running the real build.
 *
 * Nothing here reaches a database, a provider or the network. The write seam is
 * replaced by one that THROWS, so a test that accidentally invoked the
 * repository would fail loudly rather than reach a client.
 */
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('WS-4B binding suite performs no read'); },
  ownedDbRpc: () => { throw new Error('WS-4B binding suite performs no read'); },
}));

import fs from 'fs';
import path from 'path';
import {
  extractFunctionBody,
  findFirstPartyRequires,
  findNamespaceImports,
  specifierNamesModule,
  stripComments,
} from '../helpers/firstPartyModuleBinding';
// The real module, bound the way the route now binds it. Its EXPORTED SHAPE is
// what section 4 compares against the route's own declared interface.
import * as attestedIdentityRepository from '../../services/engagementIdentity/attestedIdentityRepository';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ROUTE_REL = 'pages/api/prospect-identity/owned-identities.ts';
const ROUTE_DIR = path.join(REPO_ROOT, 'pages', 'api', 'prospect-identity');
const REPOSITORY_SUFFIX = 'backend/services/engagementIdentity/attestedIdentityRepository';

/** Read once. A missing file throws here, which is the correct answer. */
const ROUTE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, ROUTE_REL), 'utf8');
const ROUTE_CODE = stripComments(ROUTE_SOURCE);

/**
 * THE HISTORICAL FORM, verbatim in substance.
 *
 * Section 1 runs the real detectors against this and requires them to FIRE.
 * Without it every assertion in this file could pass because the detectors
 * silently match nothing — which is precisely the failure mode that let the
 * defect through the first time. Assembled from lines rather than a template
 * literal so the fixture carries no incidental whitespace of its own.
 */
const REGRESSED_FORM = [
  "import type { NextApiRequest, NextApiResponse } from 'next';",
  "import { logger } from '../../../backend/services/logger';",
  '',
  '/**',
  ' * The repository, resolved LAZILY so this file compiles before WS-A lands.',
  ' * A namespace import would do the same thing.',
  ' */',
  'function loadRegistry(): AttestedIdentityRepositoryModule {',
  '  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require',
  "  const mod = require('../../../backend/services/engagementIdentity/attestedIdentityRepository');",
  '  return mod as AttestedIdentityRepositoryModule;',
  '}',
].join('\n');

// ═══════════════════════════════════════════════════════════════════════════
// 1 · THE DETECTORS, PROVEN ON THE FORM THAT SHIPPED
//
// A structural gate is only as good as its ability to say NO. Everything below
// this section asserts an absence or a presence in the current file; this
// section asserts that the same code reaches the OPPOSITE verdict on the
// regressed source. If a refactor of the detectors ever makes them inert, this
// section fails first and names the reason.
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B binding · the detectors reject the bare-require form', () => {
  const regressedCode = stripComments(REGRESSED_FORM);

  it('the regressed source is detected as reaching the repository by a first-party require', () => {
    const requires = findFirstPartyRequires(regressedCode, {
      fileDir: ROUTE_DIR,
      repoRoot: REPO_ROOT,
    });

    expect(requires).toHaveLength(1);
    expect(specifierNamesModule(requires[0].specifier, REPOSITORY_SUFFIX)).toBe(true);
    // Resolved, not merely matched: the specifier really names the repository
    // module in this tree, so the detector is reporting a dependency rather
    // than a lookalike string.
    expect(requires[0].resolved).toBe(path.join(REPO_ROOT, REPOSITORY_SUFFIX));
  });

  it('the regressed source is detected as having NO namespace import of the repository', () => {
    const namespaced = findNamespaceImports(regressedCode)
      .filter((i) => specifierNamesModule(i.specifier, REPOSITORY_SUFFIX));

    expect(namespaced).toEqual([]);
  });

  it('the regressed `loadRegistry` body is detected as containing a require', () => {
    const body = extractFunctionBody(regressedCode, 'loadRegistry');

    expect(body).not.toBeNull();
    expect(body as string).toMatch(/\brequire\s*\(/);
  });

  it('the comment stripper does not let prose ABOUT the form satisfy a detector', () => {
    // The route's header quotes the broken form while explaining why it is
    // gone, and the fix's own comment names the namespace import. A detector
    // that read comments would therefore report the current file as BOTH
    // regressed and fixed, which is the same as reporting nothing.
    const proseOnly = [
      '/**',
      " * This was `const mod = require('../../../backend/services/engagementIdentity/attestedIdentityRepository');`",
      " * and is now `import * as attestedIdentityRepository from '../../../backend/services/engagementIdentity/attestedIdentityRepository';`",
      ' */',
      'export const nothing = 1;',
    ].join('\n');
    const stripped = stripComments(proseOnly);

    expect(findFirstPartyRequires(stripped, { fileDir: ROUTE_DIR, repoRoot: REPO_ROOT })).toEqual([]);
    expect(findNamespaceImports(stripped)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · THE ROUTE BINDS THE REPOSITORY AS A STATIC NAMESPACE IMPORT
//
// The presence half of the gate. The absence half is section 3, and BOTH are
// required: a file with neither an import nor a require of the repository would
// satisfy an absence check alone while binding nothing at all.
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B binding · the repository is a dependency the bundler links', () => {
  it('the route file was read and still holds the seam this suite is about', () => {
    // Guard the guard. A renamed route or a renamed `loadRegistry` would make
    // every assertion below vacuous, so the subject is proven to exist first.
    expect(ROUTE_SOURCE.length).toBeGreaterThan(5000);
    expect(ROUTE_CODE).toContain('function loadRegistry');
    expect(ROUTE_CODE).toContain('__setOwnedIdentityRegistryPorts');
  });

  it('the repository is bound by exactly one top-level `import * as`', () => {
    const namespaced = findNamespaceImports(ROUTE_CODE)
      .filter((i) => specifierNamesModule(i.specifier, REPOSITORY_SUFFIX));

    expect(namespaced).toHaveLength(1);
    // And the specifier resolves to the module on disk, so the import is a
    // real dependency rather than a path that happens to read correctly.
    const resolved = path.resolve(ROUTE_DIR, namespaced[0].specifier);
    expect(resolved).toBe(path.join(REPO_ROOT, REPOSITORY_SUFFIX));
    expect(fs.existsSync(`${resolved}.ts`)).toBe(true);
  });

  it('`loadRegistry` returns that binding and resolves nothing at call time', () => {
    const body = extractFunctionBody(ROUTE_CODE, 'loadRegistry');
    expect(body).not.toBeNull();

    const local = findNamespaceImports(ROUTE_CODE)
      .filter((i) => specifierNamesModule(i.specifier, REPOSITORY_SUFFIX))[0].local;

    // The identifier the import introduced is what the function hands back.
    expect(body as string).toMatch(new RegExp(`\\breturn\\b[^;]*\\b${local}\\b`));
    // And the lazy form is gone from the one function it lived in. Checked
    // separately from section 3 because THIS is the site that produced the 503:
    // a require elsewhere in the file is a latent defect, a require here is the
    // defect.
    expect(body as string).not.toMatch(/\brequire\s*\(/);
    expect(body as string).not.toMatch(/\bawait\s+import\s*\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · NO BARE `require()` OF FIRST-PARTY SOURCE SURVIVES IN THE ROUTE
//
// Scoped to the route, and to FIRST-PARTY specifiers. A package specifier
// (`next`, `fs`) is an external to the server build and is not what broke; a
// relative or `@/`-rooted specifier is source webpack must link, and is. The
// check is deliberately wider than the single dependency that failed: the
// defect is a FORM, and the next module resolved that way would fail the same
// way with no test to say so.
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B binding · the route resolves no first-party module by require', () => {
  it('finds no first-party require anywhere in the route', () => {
    const requires = findFirstPartyRequires(ROUTE_CODE, {
      fileDir: ROUTE_DIR,
      repoRoot: REPO_ROOT,
    });

    // Reported by specifier so a regression names the dependency rather than
    // just a count.
    expect(requires.map((r) => r.specifier)).toEqual([]);
  });

  it('every first-party dependency of the route is reached by `import`', () => {
    // The positive statement of the same property, and the reason this is not
    // a vacuous absence: the route really does have first-party dependencies,
    // and they are all import statements.
    const imports = ROUTE_CODE.match(/^\s*import\b[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? [];
    const firstParty = imports.filter((line) => /from\s+['"]\.{1,2}\//.test(line));

    expect(firstParty.length).toBeGreaterThanOrEqual(5);
    expect(firstParty.some((line) => line.includes(REPOSITORY_SUFFIX))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · THE SHAPE THE ROUTE CLAIMS IS THE SHAPE THE MODULE EXPORTS
//
// A linked binding is necessary and not sufficient. `loadRegistry()` casts the
// namespace to `AttestedIdentityRepositoryModule`, so the compiler checks
// nothing about whether the module really provides those members: a renamed
// export would leave `listActiveAttestedIdentities` `undefined` and reproduce
// the ORIGINAL 503 by a different route.
//
// The member names are read OUT OF THE ROUTE rather than restated here, so the
// two sides cannot drift apart silently. This is a shape claim only — the
// argument shape of the adapter is pinned by the port-contract section of
// `piWs4bOwnedIdentityRoutes.test.ts` and is not restated.
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4B binding · the declared repository interface is really exported', () => {
  const declaredMembers = (): string[] => {
    const block = ROUTE_CODE.match(
      /interface\s+AttestedIdentityRepositoryModule\s*\{([\s\S]*?)\n\}/,
    );
    if (block === null) return [];
    return (block[1].match(/^\s*([A-Za-z_$][\w$]*)\s*\(/gm) ?? [])
      .map((m) => m.trim().replace(/\($/, ''));
  };

  it('the route declares the interface this suite reads', () => {
    const members = declaredMembers();

    // Guard the guard: an unreadable interface block would make the next test
    // assert nothing at all.
    expect(members).toContain('listActiveAttestedIdentities');
    expect(members.length).toBeGreaterThanOrEqual(3);
  });

  it('every declared member is a function on the real repository module', () => {
    const module = attestedIdentityRepository as unknown as Record<string, unknown>;

    for (const member of declaredMembers()) {
      expect({ member, type: typeof module[member] }).toEqual({ member, type: 'function' });
    }
  });
});
