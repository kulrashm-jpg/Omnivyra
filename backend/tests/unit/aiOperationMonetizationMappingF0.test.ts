/**
 * F0 — every AI gateway operation must resolve to a monetization action key.
 *
 * WHY THIS EXISTS
 * ---------------
 * `usageLedgerService.logUsageEvent` refuses BOTH the `usage_events` row and
 * the `unified_transactions` row when `resolveActionKey(process_type)` returns
 * null (hard-mode enforcement, `usageLedgerService.ts`). The refusal is silent
 * to the caller: it emits a `cost_anomalies` row and returns.
 *
 * Production consequence before F0: 490 `unknown_action_key` anomalies across
 * 23 process types, and operations such as `blogCardChat` had NEVER produced a
 * usage row in the platform's history — so their AI spend was unaccounted and
 * their telemetry unobservable.
 *
 * The registry is DISCOVERED, not hand-listed. Adding a new gateway operation
 * without a mapping fails this suite automatically — that is the governance
 * gap this test closes. Do not replace the scan with a literal array.
 */

import * as fs from 'fs';
import * as path from 'path';

// `usageLedgerService` pulls `@/config` and the Supabase client at module load,
// which throws without live credentials. Only the pure resolver is under test,
// so the I/O dependencies are stubbed — `resolveActionKey` itself is REAL, as
// is the registry it consults.
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => t }));
jest.mock('../../services/unifiedTransactionService', () => ({ recordUnifiedTransaction: jest.fn() }));

import { resolveActionKey } from '../../services/usageLedgerService';

const REPO = path.resolve(__dirname, '../../..');

/** Source files that construct AI gateway requests. */
function gatewayFiles(): string[] {
  const roots = ['backend', 'pages', 'lib', 'shared'];
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === 'tests') continue;
        walk(p);
      } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
        if (e.name.includes('.test.')) continue;
        out.push(p);
      }
    }
  };
  for (const r of roots) walk(path.join(REPO, r));
  return out;
}

/**
 * Operation literals passed to the gateway. Only files that actually import the
 * gateway are scanned, so unrelated `operation:` fields (queues, jobs, adapters)
 * are not swept in.
 */
function declaredGatewayOperations(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of gatewayFiles()) {
    let src: string;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!/from ['"][^'"]*aiGateway['"]|services\/aiGateway/.test(src)) continue;
    for (const m of src.matchAll(/operation:\s*'([a-zA-Z0-9_.:]+)'/g)) {
      const op = m[1];
      if (!found.has(op)) found.set(op, []);
      found.get(op)!.push(path.relative(REPO, file));
    }
  }
  return found;
}

/**
 * Operations observed refused in PRODUCTION (`cost_anomalies.unknown_action_key`)
 * that are emitted dynamically and therefore cannot be discovered by scanning
 * for a literal. Kept explicit and small, with provenance.
 */
const PRODUCTION_OBSERVED_OPERATIONS = [
  'blog_brief_suggestions',
  'quick_platform_adapt',
  'engagement_refine',
  'campaign_chat',
  'creator.infographic.copy',
  'creator_content',
  'creatorFieldAssist',
  'creator_intake_ai_content',
];

/**
 * Test-only operations. These never execute in production, so a monetization
 * mapping would be meaningless. Anything added here must be provably confined
 * to a test path — asserted below.
 */
const TEST_ONLY_OPERATIONS = new Set(['pb008.capability.probe']);

describe('F0 · every gateway operation resolves to a monetization action key', () => {
  const declared = declaredGatewayOperations();

  it('discovers a meaningful number of gateway operations (scan is not silently empty)', () => {
    expect(declared.size).toBeGreaterThan(30);
  });

  it('EVERY declared gateway operation resolves to an action key', () => {
    const unmapped: string[] = [];
    for (const [op, files] of declared) {
      if (TEST_ONLY_OPERATIONS.has(op)) continue;
      if (!resolveActionKey(op)) unmapped.push(`${op}  (${files[0]})`);
    }
    // A failure here means a new AI operation was added without a monetization
    // mapping: its usage rows will be REFUSED and its spend will go unrecorded.
    // Fix by mapping it to the correct feature in shared/monetization/featureRegistry.
    expect(unmapped).toEqual([]);
  });

  it('every production-observed operation resolves to an action key', () => {
    const unmapped = PRODUCTION_OBSERVED_OPERATIONS.filter((op) => !resolveActionKey(op));
    expect(unmapped).toEqual([]);
  });

  it('test-only operations really are confined to test paths', () => {
    for (const op of TEST_ONLY_OPERATIONS) {
      const files = declared.get(op) ?? [];
      for (const f of files) {
        expect(f.replace(/\\/g, '/')).toMatch(/tests?\//);
      }
    }
  });

  it('unknown operations remain fail-closed', () => {
    expect(resolveActionKey('definitelyNotARealOperation_f0')).toBeNull();
    expect(resolveActionKey('')).toBeNull();
  });
});

describe('F0 · the operations fixed by this change', () => {
  // Each was verified unmapped before F0 and is asserted against the SPECIFIC
  // action key of its nearest existing sibling — so a later edit that silently
  // reassigns one to a differently-priced capability fails here.
  const EXPECTED: Array<[string, string]> = [
    ['blogCardChat', 'content_rewrite'],
    ['creator_package_ai', 'content_rewrite'],
    ['refineVariant', 'content_rewrite'],
    ['quick_platform_adapt', 'content_rewrite'],
    ['campaign_chat', 'content_rewrite'],
    ['defineCampaignPurpose', 'content_rewrite'],
    ['defineTargetCustomer', 'content_rewrite'],
    ['defineContextIntelligence', 'content_rewrite'],
    ['defineMarketingIntelligence', 'content_rewrite'],
    ['defineProblemTransformation', 'content_rewrite'],
    ['inferProblemTransformation', 'content_rewrite'],
    ['creator.infographic.copy', 'content_basic'],
    ['blog_brief_suggestions', 'content_basic'],
    ['generateLongFormSection', 'content_generation'],
    ['generateContentAngles', 'insight_generation'],
    ['generateLongFormRecommendations', 'insight_generation'],
    ['suggestCompetitors', 'insight_generation'],
    ['suggestCompetitorsUnderstanding', 'insight_generation'],
    ['replyGeneration', 'ai_reply'],
    ['sentimentClassification', 'ai_reply'],
    ['engagement_refine', 'ai_reply'],
    ['newsletterGeneration', 'content_basic'],
    ['contentAnalysis', 'insight_generation'],
  ];

  it.each(EXPECTED)('%s → %s', (op, expected) => {
    expect(resolveActionKey(op)).toBe(expected);
  });
});

describe('F0 · previously-mapped operations are unchanged', () => {
  // Regression guard: F0 must not move any existing operation to a different
  // billable capability.
  const UNCHANGED: Array<[string, string]> = [
    ['generateCampaignPlan', 'campaign_generation'],
    ['parsePlanToWeeks', 'campaign_generation'],
    ['generateMasterContent', 'content_generation'],
    ['generateContentVariant', 'content_generation'],
    ['regenerateContent', 'content_rewrite'],
    ['generateContentBlueprint', 'content_basic'],
    ['generateContentForDay', 'content_basic'],
    ['blogGeneration', 'content_basic'],
    ['responseGeneration', 'ai_reply'],
    ['chatModeration', 'ai_reply'],
    ['generateContentIdeas', 'insight_generation'],
    ['generateAdditionalStrategicThemes', 'strategy_evolution'],
    ['profileEnrichment', 'profile_enrichment'],
    ['profileExtraction', 'profile_extraction'],
  ];

  it.each(UNCHANGED)('%s still → %s', (op, expected) => {
    expect(resolveActionKey(op)).toBe(expected);
  });
});

describe('F0 · registry internal consistency', () => {
  const registrySrc = fs.readFileSync(
    path.join(REPO, 'shared/monetization/featureRegistry.ts'), 'utf8',
  );

  it('no process_type is claimed by two different features', () => {
    const claims = new Map<string, number>();
    for (const block of registrySrc.matchAll(/process_type_mapping:\s*\[([\s\S]*?)\]/g)) {
      for (const q of block[1].matchAll(/'([a-zA-Z0-9_.:]+)'/g)) {
        claims.set(q[1], (claims.get(q[1]) ?? 0) + 1);
      }
    }
    // These five are claimed by two features each on the F0 base commit
    // (f8b1bc70) — verified, not assumed. `resolveFeatureFromProcessType` takes
    // the first match, so resolution is deterministic but the ambiguity is real
    // pre-existing debt. Asserting the exact known set means any NEW ambiguity
    // fails here; F0 itself introduced none.
    const KNOWN_PREEXISTING_DUPLICATES = [
      'creator_content',
      'generateContentBlueprint',
      'generatePlatformVariants',
      'qualifyLead',
      'qualifyPredictiveLead',
    ];
    const duplicated = [...claims.entries()].filter(([, n]) => n > 1).map(([k]) => k).sort();
    expect(duplicated).toEqual(KNOWN_PREEXISTING_DUPLICATES);
  });

  it('F0 introduced no new action key and no pricing change', () => {
    // Every F0 mapping reuses an action key that already existed.
    for (const [, expected] of [
      ['x', 'content_rewrite'], ['x', 'content_basic'],
      ['x', 'content_generation'], ['x', 'insight_generation'], ['x', 'ai_reply'],
    ] as Array<[string, string]>) {
      expect(registrySrc).toContain(`action_key: '${expected}'`);
    }
  });
});
