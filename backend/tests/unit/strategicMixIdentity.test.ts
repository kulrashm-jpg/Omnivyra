/**
 * STRATEGIC MIX IDENTITY CONTRACT — P0 (STRATEGIC-MIX-SPEC-001 §0, invariant
 * I-12: exactly ONE route may claim Strategic Mix; generator modes may not
 * re-label themselves as it).
 *
 * Locks:
 *  1. The creation-model registry routes strategic-mix-campaign to the
 *     Campaign Planner (the canonical shell) — NOT to the BOLT Combined form.
 *  2. Intelligent Mix is PRESERVED unchanged: its registry entry still routes
 *     to bolt-combined-strategy, and its page still renders the combined
 *     builder.
 *  3. Every navigation surface uses the canonical name ("Strategic Mix") and
 *     the canonical route (/campaign-planner?mode=direct): campaign hub card,
 *     global header nav, next-action prompt.
 *  4. The BOLT Combined page no longer claims the Strategic Mix name in user-
 *     facing copy.
 *  5. The quarantined dead code (IntelMixView / useIntelMix) stays banner-
 *     marked and importer-free.
 *
 * Source-scan style (same pattern as the cron schedule contract): these are
 * identity/registry facts, not runtime behavior — no rendering needed.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  CONTENT_TYPE_BY_ID,
  listContentTypes,
} from '../../../lib/content/unifiedCreationModel';

const CANONICAL_ROUTE = '/campaign-planner?mode=direct';
const read = (rel: string) => readFileSync(join(__dirname, '../../../', rel), 'utf8');

describe('creation-model registry (the machine-readable identity)', () => {
  it('strategic-mix-campaign routes to the Campaign Planner', () => {
    expect(CONTENT_TYPE_BY_ID['strategic-mix-campaign']?.entryRoute).toBe(CANONICAL_ROUTE);
    expect(CONTENT_TYPE_BY_ID['strategic-mix-campaign']?.label).toBe('Strategic Mix Campaign');
  });

  it('Intelligent Mix is preserved: still routes to the BOLT Combined builder', () => {
    expect(CONTENT_TYPE_BY_ID['intelligent-mix-campaign']?.entryRoute).toBe(
      '/command-center/bolt-combined-strategy',
    );
  });

  it('exactly ONE campaign-lane entry claims the planner route (no duplicate identity)', () => {
    const claimants = listContentTypes('campaign').filter((c) =>
      c.entryRoute.startsWith('/campaign-planner'),
    );
    expect(claimants.map((c) => c.id)).toEqual(['strategic-mix-campaign']);
  });

  it('no campaign entry besides Intelligent Mix points at bolt-combined-strategy', () => {
    const claimants = listContentTypes('campaign').filter((c) =>
      c.entryRoute.includes('bolt-combined-strategy'),
    );
    expect(claimants.map((c) => c.id)).toEqual(['intelligent-mix-campaign']);
  });
});

describe('navigation surfaces (source contract)', () => {
  it('campaign hub card: canonical name + canonical route', () => {
    const src = read('pages/command-center/campaigns.tsx');
    expect(src).toContain("title: 'Strategic Mix'");
    expect(src).toContain("cta: 'Open Strategic Mix'");
    expect(src).toContain(`route: '${CANONICAL_ROUTE}'`);
    expect(src).not.toMatch(/['"]Strategy Mix['"]/); // stale name eliminated
  });

  it('global header nav: canonical name + canonical route', () => {
    const src = read('components/layout/GlobalHeaderNav.tsx');
    expect(src).toContain("label: 'Strategic Mix'");
    expect(src).toContain(`href: '${CANONICAL_ROUTE}'`);
    expect(src).not.toMatch(/label:\s*['"]Strategy Mix['"]/);
  });

  it('next-action prompt: canonical name + canonical route', () => {
    const src = read('hooks/useNextActionPrompt.ts');
    expect(src).toContain("label: 'Open Strategic Mix'");
    expect(src).toContain(`href: '${CANONICAL_ROUTE}'`);
  });

  it('the planner page carries the Strategic Mix browser identity (title)', () => {
    const src = read('pages/campaign-planner.tsx');
    expect(src).toContain('<title>Strategic Mix — Campaign Planner | Omnivyra</title>');
  });

  it('the BOLT Combined page no longer claims the Strategic Mix name in user copy', () => {
    const src = read('components/command-center/BoltCombinedStrategyMain.tsx');
    expect(src).not.toMatch(/Strateg(y|ic) Mix/);
  });
});

describe('Intelligent Mix preservation + dead-code quarantine', () => {
  it('intelligent-mix-strategy page still renders the combined builder', () => {
    const src = read('pages/command-center/intelligent-mix-strategy.tsx');
    expect(src).toMatch(/<BoltCombinedStrategyPage\s*\/>/);
  });

  it('IntelMixView and useIntelMix are banner-quarantined', () => {
    expect(read('components/IntelMixView.tsx')).toContain('@deprecated DEAD CODE — QUARANTINED');
    expect(read('hooks/useIntelMix.tsx')).toContain('@deprecated DEAD CODE — QUARANTINED');
  });

  it('nothing imports the quarantined modules (value or type)', () => {
    // Cheap targeted sweep of the UI trees where an import could live.
    const { execSync } = require('child_process');
    // The quarantined pair may reference each other; nothing OUTSIDE it may.
    const out = execSync(
      'git grep -l -E "from .((\\.\\./)+|@/)(components/IntelMixView|hooks/useIntelMix)" -- pages components hooks lib ' +
        '":!components/IntelMixView.tsx" ":!hooks/useIntelMix.tsx" || exit 0',
      { cwd: join(__dirname, '../../../'), encoding: 'utf8' },
    ).trim();
    expect(out).toBe('');
  });
});
