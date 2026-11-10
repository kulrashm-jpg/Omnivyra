/**
 * SAFETY-GATE-001 — regression test for scripts/ci/safety-test-suites.js.
 *
 * The selector is the only thing standing between the execution-safety suites
 * and "never ran in CI". These tests pin: registered suites exist, every stack
 * safety suite is selected, unrelated suites are NOT selected, the floor guard
 * trips, and a missing registered file fails loudly instead of shrinking the set.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const selector = require('../../../scripts/ci/safety-test-suites.js') as {
  SAFETY_SUITE_REGISTRY: string[];
  SAFETY_NAME_CONVENTION: RegExp;
  MIN_EXPECTED: number;
  selectSafetySuites: (opts?: { root?: string; registry?: string[]; minExpected?: number }) => {
    selected: Array<{ rel: string; reasons: string[] }>;
    missing: string[];
    errors: string[];
  };
};

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'safety-test-suites.js');
const PI_SCRIPT = path.join(ROOT, 'scripts', 'ci', 'pi-test-suites.js');

/**
 * Every unit suite added or changed by the orchestration / execution-safety
 * stack (git diff --name-only d51360b0 dd320365 -- backend/tests, minus helpers
 * and the real-schema suite) that the PI gate does not select.
 */
const STACK_SAFETY_SUITES = [
  'browserEngineAdapter',
  'communityAiActionExecutor.manualApi',
  'communityExecutionSafety.executor',
  'communityExecutionSafety.migration',
  'communityExecutionSafety.retryQueue',
  'communityExecutionSafety.rpa',
  'communityExecutionSafety.targets',
  'dmDispatchSafety.extension',
  'engagementAiSendBoundaryF5',
  'engagementBulkDispatchAcceptance',
  'engagementBulkDmClosureP11',
  'engagementBulkGovernanceP12',
  'engagementReplyLikeIdempotency',
  'engagementRequestIdempotency.migration',
  'engagementRequestIdempotencyDurable',
  'extensionClaimLeaseDeliverySafety',
  'extensionDispatchLeaseRenewal',
  'extensionDispatchSafety.migration',
  'extensionDispatchSafety.routes',
  'identityVerificationContract',
  'orchestrationCommunityAdapter',
  'orchestrationCommunityEngineSeam',
  'orchestrationCommunityIdentityLink',
  'orchestrationCommunityJourneyLink',
  'orchestrationDefinitionReadback',
  'orchestrationEngineContract',
  'orchestrationTargetingContract',
  'publishChannelVocabulary',
  'rpaSessionSecurity',
  'socialPostAdapterSafety',
  'socialPostStepContract',
  'socialPublishEngineAdapter',
  'w0cWhatsappBroadcastGovernance',
  // Added by the migration/CI/ops/session wave (integration owner, 2026-10-28).
  'migrationRerunSafety',
  'rpaLegacySessionInvalidation',
  'rpaAuthTokenRedemptionPrune',
  'engagementBulkLikeIdempotency',
  'extensionProductionTargeting',
  'extensionSourceRootPortability',
].map((n) => `backend/tests/unit/${n}.test.ts`);

/**
 * Modules and migrations INTRODUCED by this stack. A unit suite that references
 * any of them is safety-relevant by construction, and none existed before the
 * stack, so this cannot pull legacy suites in. Every such suite — including ones
 * added later — must be selected by the PI gate or this gate.
 */
const NEW_SAFETY_MARKERS = [
  'engagementRequestIdempotency',
  'rpaTargetUrlPolicy',
  'dmDispatchSafety',
  'identityVerification/',
  'communityIdentityProof',
  'rpaLegacySessionFilePurge',
  '20261231000',
  // CI-ENFORCE-001: the rest of the surface the stack introduced. Each marker
  // below was measured to have ZERO references in backend/tests at d51360b0
  // (pre-stack), and every suite referencing one at aa5e6966 was already
  // selected by the PI or safety gate, so adding them changes neither selection;
  // it only stops a future suite on these modules escaping both gates.
  // Orchestration engine adapters, enrollment and journey modules (the
  // orchestration/ directory itself pre-dates the stack, so files are named).
  'orchestration/browserEngineAdapter',
  'orchestration/campaignEnrollment',
  'orchestration/communityEngineAdapter',
  'orchestration/engineAdapters',
  'orchestration/enrollment',
  'orchestration/icpEvidence',
  'orchestration/individualIntelligence',
  'orchestration/journeyPolicy',
  'orchestration/journeyReport',
  'communityJourneyLinkStore',
  'socialPostPublicationStatus',
  'socialPostStepContract',
  'socialPublishEngineAdapter',
  'whatsappEngineAdapter',
  // Execution / engine / journey stores and lists / campaigns (new directories).
  'executionInstances/',
  'executionPlans/',
  'executionSubject/',
  'outreachBridge/',
  'prospectCampaigns/',
  'prospectLists/',
  'workflowExecution/',
  'services/workflows/',
  'pages/api/execution-instances',
  'pages/api/prospect-campaigns',
  'pages/api/prospect-lists',
  'pages/api/workflows',
  'pages/api/identity-verification',
  'workflow-execution-progression',
  // RPA login-token redemption pruning / session-writer authority (new exports
  // of the pre-existing rpaAuthTokens module; the module name itself would pull
  // in unrelated pre-existing suites) and the legacy-session purge script.
  'pruneExpiredRpaAuthTokenRedemptions',
  'RPA_TOKEN_REDEMPTION_PRUNE',
  'consumeRpaAuthToken',
  'isAuthorizedRpaSessionWriter',
  'purge-legacy-rpa-session-files',
  // Bulk-like / reply / like durable request identity (new export; the route
  // name `bulk-like` would pull in pre-existing suites).
  'readClientIdempotencyKey',
  // Migrations 20261127 and 20261226-20261230, named exactly: the prefix
  // `2026122` also matches unrelated pre-existing migrations.
  '20261127000000',
  '20270111100000',
  '20270111100001',
  '20270111100002',
  '20270111100003',
  '20270111100004',
  '20270111100005',
  '20270111100006',
  // Stack rollbacks (supabase/migrations/rollbacks/), by exact basename stem.
  'community_execution_safety_rollback',
  'community_identity_link_rollback',
  'community_journey_link_rollback',
  'engagement_request_idempotency_rollback',
  'extension_dispatch_safety_rollback',
  'identity_verification_rollback',
  'migration_rerun_safety_rollback',
  'orchestration_campaign_targeting_rollback',
  'orchestration_engine_requests_engines_rollback',
  'rpa_legacy_session_invalidation_rollback',
  'social_publish_step_channel_rollback',
];

/** Stack suites the PI gate already owns; they must stay there, not move here. */
const STACK_PI_SUITES = [
  'orchestrationCampaignTargets',
  'orchestrationVerticalSlice',
  'piCampaignIdentity014',
  'piExecutionInstance033',
  'piLists001ProspectLists',
].map((n) => `backend/tests/unit/${n}.test.ts`);

/** Pre-existing suites that merely look similar; none may be selected. */
const KNOWN_UNRELATED = [
  'backend/tests/unit/aiSafetyWave1.test.ts',
  'backend/tests/unit/executionSafety.test.ts',
  'backend/tests/unit/boltExecuteIdempotency.test.ts',
  'backend/tests/unit/withIdempotencyStaleLock.test.ts',
  'backend/tests/unit/collaborationBlockTenantSafety.test.ts',
  'backend/tests/orchestration/distributed/distributedReclaimSafetyGovernor.test.ts',
];

function tempTree(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-sel-'));
  for (const rel of files) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '// fixture\n');
  }
  return dir;
}

describe('safety-test-suites selector', () => {
  const result = selector.selectSafetySuites();
  const selected = result.selected.map((s) => s.rel);

  it('selects cleanly against the real tree', () => {
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it('every registered suite exists on disk and is selected', () => {
    for (const rel of selector.SAFETY_SUITE_REGISTRY) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
      expect(selected).toContain(rel);
    }
  });

  it('selects every stack safety suite', () => {
    const notSelected = STACK_SAFETY_SUITES.filter((rel) => !selected.includes(rel));
    expect(notSelected).toEqual([]);
  });

  it('gates itself (this regression test is registered)', () => {
    expect(selected).toContain('backend/tests/unit/safetyTestSuitesSelector.test.ts');
  });

  it('does not select known-unrelated look-alike suites', () => {
    for (const rel of KNOWN_UNRELATED) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
      expect(selected).not.toContain(rel);
    }
  });

  it('does not duplicate suites the PI gate already owns', () => {
    for (const rel of STACK_PI_SUITES) expect(selected).not.toContain(rel);
  });

  it('selects only registry entries or exact naming-convention matches', () => {
    for (const s of result.selected) {
      const byRegistry = selector.SAFETY_SUITE_REGISTRY.includes(s.rel);
      const byConvention = s.rel.startsWith('backend/tests/unit/')
        && !s.rel.slice('backend/tests/unit/'.length).includes('/')
        && selector.SAFETY_NAME_CONVENTION.test(path.basename(s.rel));
      expect(byRegistry || byConvention).toBe(true);
    }
  });

  it('naming convention requires the dotted facet and the Safety/Idempotency stem', () => {
    const re = selector.SAFETY_NAME_CONVENTION;
    expect(re.test('migrationRerunSafety.replay.test.ts')).toBe(true);
    expect(re.test('bulkLikeIdempotency.retry.test.ts')).toBe(true);
    expect(re.test('migrationRerunSafety.test.ts')).toBe(false);
    expect(re.test('aiSafetyWave1.test.ts')).toBe(false);
    expect(re.test('executionSafety.test.ts')).toBe(false);
    expect(re.test('communityExecutionSafety.rpa.test.tsx')).toBe(false);
  });

  it('union of the PI gate and the safety gate covers the whole stack', () => {
    const pi = spawnSync(process.execPath, [PI_SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(pi.status).toBe(0);
    const piSet = new Set(pi.stdout.split('\n').filter(Boolean));
    for (const rel of STACK_PI_SUITES) expect(piSet.has(rel)).toBe(true);
    const uncovered = STACK_SAFETY_SUITES.filter((rel) => !piSet.has(rel) && !selected.includes(rel));
    expect(uncovered).toEqual([]);
  });

  it('every suite that references a module this stack introduced is gated (catches future suites)', () => {
    const pi = spawnSync(process.execPath, [PI_SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(pi.status).toBe(0);
    const gated = new Set([...pi.stdout.split('\n').filter(Boolean), ...selected]);
    // The default jest project's whole territory, not only backend/tests/unit:
    // a suite added under backend/tests/integration (etc.) must not escape.
    // realschema/ and manual/ are excluded exactly as jest.config.js and the PI
    // selector exclude them (real-schema suites have their own workflow).
    const testsRoot = path.join(ROOT, 'backend', 'tests');
    const walk = (dir: string, acc: string[]): string[] => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (dir === testsRoot && (e.name === 'realschema' || e.name === 'manual')) continue;
          walk(full, acc);
        } else if (e.isFile() && /\.test\.tsx?$/.test(e.name)) acc.push(full);
      }
      return acc;
    };
    const referencing = walk(testsRoot, [])
      .filter((abs) => {
        const src = fs.readFileSync(abs, 'utf8');
        return NEW_SAFETY_MARKERS.some((m) => src.includes(m));
      })
      .map((abs) => path.relative(ROOT, abs).split(path.sep).join('/'));
    expect(referencing.length).toBeGreaterThan(10);           // the guard is not vacuous
    expect(referencing.filter((rel) => !gated.has(rel))).toEqual([]);
  });

  it('every stack marker matches at least one suite unless it is listed as untested surface', () => {
    // Guards against a typo'd marker that can never match. Markers with no
    // referencing suite at aa5e6966 are listed here on purpose (surface with no
    // unit suite yet); a later suite that covers one is fine and needs no edit.
    const UNREFERENCED_TODAY = new Set([
      'orchestration/icpEvidence',
      'orchestration/journeyPolicy',
      'isAuthorizedRpaSessionWriter',
      'workflow-execution-progression',
      'purge-legacy-rpa-session-files',
      '20270111100006',
    ]);
    const unitDir = path.join(ROOT, 'backend', 'tests', 'unit');
    const sources = fs.readdirSync(unitDir)
      .filter((f) => /\.test\.tsx?$/.test(f) && f !== 'safetyTestSuitesSelector.test.ts')
      .map((f) => fs.readFileSync(path.join(unitDir, f), 'utf8'));
    const dead = NEW_SAFETY_MARKERS
      .filter((m) => !UNREFERENCED_TODAY.has(m))
      .filter((m) => !sources.some((s) => s.includes(m)));
    expect(dead).toEqual([]);
    for (const m of UNREFERENCED_TODAY) expect(NEW_SAFETY_MARKERS).toContain(m);
  });

  it('floor guard: a selection below the floor is an error', () => {
    expect(selector.MIN_EXPECTED).toBe(selector.SAFETY_SUITE_REGISTRY.length);
    expect(selected.length).toBeGreaterThanOrEqual(selector.MIN_EXPECTED);
    const r = selector.selectSafetySuites({ minExpected: selected.length + 1 });
    expect(r.errors.some((e) => /below the floor/.test(e))).toBe(true);
  });

  it('a missing registered file fails loudly instead of shrinking the set', () => {
    const present = 'backend/tests/unit/presentSafety.facet.test.ts';
    const gone = 'backend/tests/unit/goneSuite.test.ts';
    const dir = tempTree([present]);
    try {
      const r = selector.selectSafetySuites({ root: dir, registry: [present, gone] });
      expect(r.missing).toEqual([gone]);
      expect(r.errors.join('\n')).toContain(gone);
      expect(r.selected.map((s) => s.rel)).toEqual([present]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects registry entries jest would ignore, duplicates and non-test files', () => {
    const files = [
      'backend/tests/realschema/x.test.ts',
      'backend/tests/unit/dup.test.ts',
      'backend/tests/unit/helper.ts',
    ];
    const dir = tempTree(files);
    try {
      const r = selector.selectSafetySuites({
        root: dir,
        registry: [files[0], files[1], files[1], files[2]],
        minExpected: 0,
      });
      expect(r.errors.some((e) => /ignores/.test(e))).toBe(true);
      expect(r.errors.some((e) => /more than once/.test(e))).toBe(true);
      expect(r.errors.some((e) => /not a test file/.test(e))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CLI exits 0 and prints exactly the selected list', () => {
    const out = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(out.status).toBe(0);
    expect(out.stdout.split('\n').filter(Boolean)).toEqual(selected);
    const count = spawnSync(process.execPath, [SCRIPT, '--count'], { cwd: ROOT, encoding: 'utf8' });
    expect(count.stdout.trim()).toBe(String(selected.length));
  });
});
