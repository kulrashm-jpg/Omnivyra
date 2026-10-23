/**
 * PI-INGEST-CONSOLIDATION-001-B — the legacy CRM source fence.
 *
 * 001-A established that the legacy CRM path is dormant in production — no CRM
 * integration, no `config.csvContent`, no crm-sourced prospect — yet still
 * reachable, and that when reached it meters a provider unit and records a
 * completed ingestion run while importing nothing. This suite proves the
 * scheduler now REFUSES the CRM source instead, and that the refusal is
 * distinguishable from both "ran and found nothing" and "no configuration".
 *
 * ─── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 * Not a retirement. `crmIngestionService` is untouched and its 001-A golden
 * master still passes unchanged — the fence sits at the scheduler boundary, so
 * the characterized implementation remains available to the re-homing work that
 * must precede any retirement.
 *
 * The collaborators are mocked at the module boundary because the assertion is
 * about which collaborators are REACHED. A test that let the real modules run
 * would need a database and would prove nothing about reachability.
 */

const probe = {
  ingestCrmData: jest.fn(),
  authorizeProviderCall: jest.fn(),
  recordProviderUsage: jest.fn(),
};

// The scheduler reads integrations and runs inside a background-job context
// before the source loop; neither is what this suite is about, so both are
// stubbed to keep the assertions on reachability rather than on infrastructure.
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }) },
}));

jest.mock('../../services/intelligenceExecutionContext', () => ({
  __esModule: true,
  runInBackgroundJobContext: (_name: string, fn: () => unknown) => fn(),
}));

jest.mock('../../services/analyticsIntegrationService', () => ({
  __esModule: true,
  getGoogleAnalyticsStatus: async () => ({ connected: false }),
  getGoogleSearchConsoleStatus: async () => ({ connected: false }),
  resolveGscIngestionContext: async () => null,
}));

// The legacy CRM importer and the provider governor: the fence must reach NONE
// of these. They are mocked so a leak is observable as a call, not as a crash.
jest.mock('../../services/crmIngestionService', () => ({
  __esModule: true,
  ingestCrmData: (...args: unknown[]) => probe.ingestCrmData(...args),
  buildCrmRunKey: () => 'crm-run-key',
}));

jest.mock('../../services/providers/providerCostGovernor', () => ({
  __esModule: true,
  authorizeProviderCall: (...args: unknown[]) => { probe.authorizeProviderCall(...args); return { allowed: true }; },
  recordProviderUsage: (...args: unknown[]) => probe.recordProviderUsage(...args),
}));

// The non-CRM runners are stubbed so a mixed-source request exercises the loop
// without performing real ingestion.
jest.mock('../../services/gscIngestionService', () => ({
  __esModule: true,
  buildGscRunKey: () => 'gsc-run-key',
  ingestGscData: async () => ({ keywordsWritten: 0 }),
}));

const lifecycle = {
  beginIngestionRun: jest.fn(async () => ({ id: 'run-1' })),
  completeIngestionRun: jest.fn(async () => undefined),
  findIngestionRunByKey: jest.fn(async () => null),
  hasRunningIngestion: jest.fn(async () => false),
  getRetryableFailedRuns: jest.fn(async () => []),
  setDataSourceStatus: jest.fn(async () => undefined),
};
jest.mock('../../services/ingestionRunService', () => ({
  __esModule: true,
  beginIngestionRun: (...a: unknown[]) => lifecycle.beginIngestionRun(...a),
  completeIngestionRun: (...a: unknown[]) => lifecycle.completeIngestionRun(...a),
  findIngestionRunByKey: (...a: unknown[]) => lifecycle.findIngestionRunByKey(...a),
  getRetryableFailedRuns: (...a: unknown[]) => lifecycle.getRetryableFailedRuns(...a),
  hasRunningIngestion: (...a: unknown[]) => lifecycle.hasRunningIngestion(...a),
  setDataSourceStatus: (...a: unknown[]) => lifecycle.setDataSourceStatus(...a),
}));

import {
  runIngestionForCompany,
  FENCED_LEGACY_SOURCE,
  LEGACY_SOURCE_FENCED_REASON,
  type IngestionSourceResult,
} from '../../services/ingestionScheduler';

const ORG = '00000000-0000-4000-8000-0000000000a1';

const crmOf = (sources: IngestionSourceResult[]) => sources.find((s) => s.source === 'crm');

describe('001-B — the CRM source is explicitly fenced', () => {
  beforeEach(() => jest.clearAllMocks());

  it('A — reports a fenced result for sources: [crm]', async () => {
    const summary = await runIngestionForCompany({ companyId: ORG, sources: ['crm'] });
    const crm = crmOf(summary.sources);
    expect(crm).toBeDefined();
    expect(crm!.skipped).toBe(true);
    expect(crm!.details).toEqual({ reason: LEGACY_SOURCE_FENCED_REASON });
  });

  it('A — does NOT report the fenced source as a success', async () => {
    // The distinction the gate exists for: a caller must not read this as
    // "CRM ingestion succeeded", nor as "ran and found no rows".
    const summary = await runIngestionForCompany({ companyId: ORG, sources: ['crm'] });
    expect(crmOf(summary.sources)!.success).toBe(false);
  });

  it('A — never reaches the legacy CRM importer', async () => {
    await runIngestionForCompany({ companyId: ORG, sources: ['crm'] });
    expect(probe.ingestCrmData).not.toHaveBeenCalled();
  });

  it('A — never reaches provider authorization or usage metering', async () => {
    await runIngestionForCompany({ companyId: ORG, sources: ['crm'] });
    expect(probe.authorizeProviderCall).not.toHaveBeenCalled();
    expect(probe.recordProviderUsage).not.toHaveBeenCalled();
  });

  it('A — creates no ingestion run for the fenced source', async () => {
    // The fence sits above the run lifecycle, so a fenced request must not leave
    // a completed run behind that later reads as a successful CRM import.
    await runIngestionForCompany({ companyId: ORG, sources: ['crm'] });
    for (const call of lifecycle.beginIngestionRun.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('"crm"');
    }
  });

  it('B — is deterministic across repeated invocations', async () => {
    const a = crmOf((await runIngestionForCompany({ companyId: ORG, sources: ['crm'] })).sources);
    const b = crmOf((await runIngestionForCompany({ companyId: ORG, sources: ['crm'] })).sources);
    const c = crmOf((await runIngestionForCompany({ companyId: ORG, sources: ['crm'] })).sources);
    expect([a, b, c].map((r) => ({ s: r!.success, k: r!.skipped, d: r!.details })))
      .toEqual([a, b, c].map(() => ({ s: false, k: true, d: { reason: LEGACY_SOURCE_FENCED_REASON } })));
    expect(probe.ingestCrmData).not.toHaveBeenCalled();
  });

  it('B — the fence is keyed on the requested source, holding no tenant state', async () => {
    // Two different tenants must both be fenced identically; a fence that
    // remembered a tenant would be cross-tenant scheduler state.
    const one = crmOf((await runIngestionForCompany({ companyId: ORG, sources: ['crm'] })).sources);
    const two = crmOf((await runIngestionForCompany({ companyId: '00000000-0000-4000-8000-0000000000b2', sources: ['crm'] })).sources);
    expect(one!.details).toEqual(two!.details);
    expect(one!.success).toBe(two!.success);
  });

  it('D — a mixed request fences CRM without discarding the other source', async () => {
    // The pre-existing contract is a per-source loop appending an independent
    // result per source, so the fence must `continue`, never abort the request.
    const summary = await runIngestionForCompany({ companyId: ORG, sources: ['gsc', 'crm'] });
    const returned = summary.sources.map((s) => s.source);
    expect(returned).toContain('crm');
    expect(returned).toContain('gsc');
    expect(crmOf(summary.sources)!.details).toEqual({ reason: LEGACY_SOURCE_FENCED_REASON });
    expect(probe.ingestCrmData).not.toHaveBeenCalled();
  });

  it('D — the non-CRM source in a mixed request is not reported as fenced', async () => {
    const summary = await runIngestionForCompany({ companyId: ORG, sources: ['gsc', 'crm'] });
    const gsc = summary.sources.find((s) => s.source === 'gsc');
    expect(gsc).toBeDefined();
    expect(gsc!.details).not.toEqual({ reason: LEGACY_SOURCE_FENCED_REASON });
  });

  it('C — a request with no CRM source produces no fenced result at all', async () => {
    const summary = await runIngestionForCompany({ companyId: ORG, sources: ['gsc'] });
    expect(summary.sources.some((s) => s.details?.reason === LEGACY_SOURCE_FENCED_REASON)).toBe(false);
    expect(crmOf(summary.sources)).toBeUndefined();
  });

  it('the fenced source constant is the legacy CRM source', () => {
    expect(FENCED_LEGACY_SOURCE).toBe('crm');
  });

  it('the fence reason is distinct from every pre-existing skip reason', () => {
    // `already_running` and `duplicate_idempotency_key` both mean "the work is
    // or was genuinely done". Reusing either would erase the distinction.
    expect(LEGACY_SOURCE_FENCED_REASON).not.toBe('already_running');
    expect(LEGACY_SOURCE_FENCED_REASON).not.toBe('duplicate_idempotency_key');
  });
});

describe('001-B — the fence covers every entry point', () => {
  it('E — the legacy importer module itself is untouched and still callable', () => {
    // The fence is a scheduler boundary, not a deletion: 001-A's golden master
    // must keep passing against the unchanged implementation.
    const legacy = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'services', 'crmIngestionService.ts'), 'utf8',
    );
    expect(legacy).toContain('export async function ingestCrmData');
    expect(legacy).not.toContain(LEGACY_SOURCE_FENCED_REASON);
  });

  it('every CRM route into the scheduler passes through the fenced loop', () => {
    // `retryFailedIngestionForCompany` and `runIngestionForAllCompanies` both
    // delegate to `runIngestionForCompany`, so one fence covers all of them.
    // Asserted from source so a future direct call site cannot bypass it silently.
    const scheduler = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'services', 'ingestionScheduler.ts'), 'utf8',
    );
    const code = scheduler.split('\n').filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    // exactly one place consumes a source list in a loop
    expect((code.match(/for \(const source of sources\)/g) ?? []).length).toBe(1);
    // and the retry path re-enters through the public entry point
    expect(code).toContain('await runIngestionForCompany({');
    // runCrmSource is only reachable from inside that loop
    expect((code.match(/runCrmSource\(/g) ?? []).length).toBe(2); // definition + single call site
  });
});
