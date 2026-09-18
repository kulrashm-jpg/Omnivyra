/**
 * Meta Graph API version — one version across the whole repo, no silent drift.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Graph version is a bare string repeated in ~25 source files (adapters,
 * connectors, OAuth callbacks, analytics, engagement ingestion, reconciliation,
 * the platform registry). Nothing held them together, and they drifted: the
 * Facebook and Instagram reconciliation providers were still on v18.0 while
 * every other caller had moved to v22.0 — so reconciliation read a post back on
 * a different API version from the one that published it, and nothing failed
 * until a real provider call was made.
 *
 * That is the exact shape of the 2026-09-16 LinkedIn version outage, which is
 * now guarded by linkedinApiVersionFreshness.test.ts. This is the Graph
 * equivalent: a repo-local, network-free check that a version bump can never be
 * applied to only some of the call sites.
 *
 * This test deliberately does NOT assert a particular version number. Picking
 * "the current Graph version" needs evidence from Meta, not from this repo; what
 * the repo can prove is that its callers agree with each other.
 */

export {};

const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Source trees that make real Graph calls. */
const SCAN_DIRS = ['backend', 'pages', 'lib', 'components', 'hooks'];

/**
 * Excluded on purpose:
 *  - backend/tests — fixtures and scanners quote URLs as literal test DATA.
 *  - node_modules / .next — not ours.
 * Markdown is not scanned at all: historical audit reports quote the versions
 * that were live when they were written, and rewriting history is not a fix.
 */
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.next', '.git', 'tests', '__tests__']);

const HOST_VERSION = /\b(?:graph|www)\.facebook\.com\/v(\d+)\.(\d+)/g;

function walk(dir: string, out: string[] = []): string[] {
  let entries: import('fs').Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

interface Occurrence {
  file: string;
  version: string;
}

function collectOccurrences(): Occurrence[] {
  const found: Occurrence[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(REPO_ROOT, dir))) {
      const src = fs.readFileSync(file, 'utf8');
      HOST_VERSION.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = HOST_VERSION.exec(src)) !== null) {
        found.push({
          file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
          version: `v${m[1]}.${m[2]}`,
        });
      }
    }
  }
  return found;
}

describe('Meta Graph API version pin', () => {
  const occurrences = collectOccurrences();

  it('the scan actually finds the Graph callers (guards against a broken scanner)', () => {
    expect(occurrences.length).toBeGreaterThan(20);
  });

  it('CRITICAL: every Graph caller in the repo sends the SAME version', () => {
    const byVersion = new Map<string, Set<string>>();
    for (const { file, version } of occurrences) {
      if (!byVersion.has(version)) byVersion.set(version, new Set());
      byVersion.get(version)!.add(file);
    }

    // Reported as { version: [files] } so a failure names exactly what drifted.
    const summary = Object.fromEntries(
      [...byVersion.entries()].map(([v, files]) => [v, [...files].sort()]),
    );

    expect(summary).toEqual({
      [[...byVersion.keys()].sort()[0]]: expect.any(Array),
    });
  });

  it('the two reconciliation providers are on that same version', () => {
    // These are the two that drifted. Named explicitly so the regression is
    // caught even if the repo-wide assertion is ever relaxed.
    const pinned = occurrences.filter((o) => o.file.includes('providerReconciliation/providers/'));
    const adapter = occurrences.filter((o) => o.file === 'backend/adapters/instagramAdapter.ts');

    expect(pinned.length).toBeGreaterThanOrEqual(2);
    expect(adapter.length).toBeGreaterThan(0);
    for (const o of pinned) {
      expect(o.version).toBe(adapter[0].version);
    }
  });

  it('every pin is a well-formed vMAJOR.MINOR', () => {
    for (const { file, version } of occurrences) {
      expect(`${file}:${version}`).toMatch(/:v\d+\.\d+$/);
    }
  });
});
