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

  it('every unit suite that references a module this stack introduced is gated (catches future suites)', () => {
    const pi = spawnSync(process.execPath, [PI_SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(pi.status).toBe(0);
    const gated = new Set([...pi.stdout.split('\n').filter(Boolean), ...selected]);
    const unitDir = path.join(ROOT, 'backend', 'tests', 'unit');
    const referencing = fs.readdirSync(unitDir)
      .filter((f) => /\.test\.tsx?$/.test(f))
      .filter((f) => NEW_SAFETY_MARKERS.some((m) => fs.readFileSync(path.join(unitDir, f), 'utf8').includes(m)))
      .map((f) => `backend/tests/unit/${f}`);
    expect(referencing.length).toBeGreaterThan(10);           // the guard is not vacuous
    expect(referencing.filter((rel) => !gated.has(rel))).toEqual([]);
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
