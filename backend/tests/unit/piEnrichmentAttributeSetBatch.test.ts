/**
 * Enrichment of an attribute SET in one provider call, and the capped batch run.
 *
 * Why it matters: Apollo (and Clearbit) answer a whole person or organization
 * in one paid call. Executing field by field would pay once per attribute for
 * the same answer, and a batch without a hard budget is an open-ended spend.
 *
 * SECRETS: synthetic only. No network, no database: every port is doubled.
 */

import { executePlannedField } from '../../services/enrichment/execution';
import {
  executeProspectEnrichmentBatch,
  previewProspectEnrichmentBatch,
  MAX_ENRICHMENT_BATCH_PROSPECTS,
  MAX_ENRICHMENT_BATCH_PROVIDER_CALLS,
} from '../../apiHandlers/prospects/prospectIntelligenceRead';
import type { EnrichmentPlan, PlannedField } from '../../services/enrichment/planner';
import type { EnrichmentPorts, ProspectSnapshot } from '../../services/enrichment/service';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type { EnrichmentProviderAdapter, EnrichmentRequest } from '../../services/enrichment/providers/contract';
import type { SourceStatus } from '../../services/enrichment/providers/sources';

const ORG = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-11-10T00:00:00.000Z';

const status = (): SourceStatus => ({
  id: 'clearbit',
  displayName: 'Clearbit',
  sourceType: 'external_api',
  capabilities: { entities: ['account'], attributes: ['employee_count', 'founded_year'] },
  credentialEnvVar: 'CLEARBIT_API_KEY',
  authorizationRequirements: [],
  creditAction: null,
  fundingModel: 'tenant_provider_subscription',
  priority: 25,
  note: 'synthetic',
  connectionState: 'connected',
  usable: true,
  stateReason: 'synthetic: connected',
} as SourceStatus);

const field = (over: Partial<PlannedField> = {}): PlannedField => ({
  attribute: 'employee_count',
  subject: 'account',
  state: 'missing',
  requiredForNextAction: false,
  action: 'enrich',
  source: 'clearbit',
  sourceStatus: 'connected',
  cost: { kind: 'unknown' },
  reason: 'synthetic planned field',
  ...over,
} as PlannedField);

const plan = (prospectId = 'lead-1'): EnrichmentPlan => ({
  organizationId: ORG, prospectId, version: 'ws2.1', generatedAt: NOW,
  fields: [], toEnrich: [], counts: { known: 0, missing: 2, stale: 0, conflicting: 0 },
  empty: false, stalenessDays: null,
} as EnrichmentPlan);

const snapshot = (n = 1): ProspectSnapshot => ({
  personId: `person-${n}`,
  accountId: `acct-${n}`,
  person: { id: `person-${n}`, status: 'active', primary_email: `p${n}@example.com`, full_name: 'A Person' },
  account: { id: `acct-${n}`, status: 'active', domain_normalized: `example${n}.com`, name: 'Example' },
});

function harness(opts: { throwOnCall?: number } = {}) {
  const calls: EnrichmentRequest[] = [];
  const adapter: EnrichmentProviderAdapter = {
    id: 'clearbit',
    label: 'Clearbit',
    supports: ['employee_count', 'founded_year'],
    credentialEnvVar: 'CLEARBIT_API_KEY',
    isAvailable: () => false,
    async enrich(request) {
      calls.push(request);
      if (opts.throwOnCall === calls.length) throw new TypeError('synthetic transport bug');
      return {
        outcome: 'enriched',
        fields: request.attributes.map((attribute) => ({
          attribute, subject: 'account' as const, value: attribute === 'employee_count' ? 250 : 2011,
          observedAt: null, confidence: null, providerInferred: false,
        })),
        notReturned: [],
      };
    },
  };
  const ports: ExecuteEnrichmentPorts = {
    async authorizeCost() { return { authorized: true, holdId: null, cost: { kind: 'unknown' } }; },
    async releaseCost() { /* tenant-funded */ },
    async resolveCredential() { return 'synthetic-tenant-key'; },
    async findRecentObservation() { return null; },
    async persistObservation() { return { sourceRecordId: 'src-1', canonicalWithheld: [] }; },
    now: () => NOW,
  };
  const recorder = {
    now: () => NOW,
    nextNumber: async () => 1,
    latest: async () => null,   // explicit: no prior attempt (mode B user-path rule)
    record: async () => ({ attemptId: 'attempt-1' }),
    complete: async () => { /* recorded */ },
    markPending: async () => { /* marked */ },
  };
  return { calls, adapter, ports, recorder };
}

describe('one provider request for an attribute set (alsoFields)', () => {
  it('sends the whole set in ONE call and reports the set', async () => {
    const hz = harness();
    const out = await executePlannedField({
      plan: plan(),
      field: field(),
      alsoFields: [field({ attribute: 'founded_year' })],
      snapshot: snapshot(),
      statuses: [status()],
      adapter: hz.adapter,
      recorder: hz.recorder as never,
    }, hz.ports);
    expect(hz.calls).toHaveLength(1);
    expect(hz.calls[0].attributes).toEqual(['employee_count', 'founded_year']);
    expect(out.outcome).toBe('enriched');
    expect(out.attributes).toEqual(['employee_count', 'founded_year']);
  });

  it('a companion that is not an enrich of the same subject and source refuses the WHOLE set, free', async () => {
    for (const bad of [
      field({ attribute: 'founded_year', action: 'skip' }),
      field({ attribute: 'job_title', subject: 'person' }),
      field({ attribute: 'founded_year', source: 'apollo' }),
    ]) {
      const hz = harness();
      const out = await executePlannedField({
        plan: plan(), field: field(), alsoFields: [bad], snapshot: snapshot(), statuses: [status()],
        adapter: hz.adapter, recorder: hz.recorder as never,
      }, hz.ports);
      expect(out.refusal).toBe('not_executable');
      expect(hz.calls).toHaveLength(0);
    }
  });

  it('without companions the result is unchanged: no attributes key', async () => {
    const hz = harness();
    const out = await executePlannedField({
      plan: plan(), field: field(), snapshot: snapshot(), statuses: [status()],
      adapter: hz.adapter, recorder: hz.recorder as never,
    }, hz.ports);
    expect(out).not.toHaveProperty('attributes');
    expect(hz.calls[0].attributes).toEqual(['employee_count']);
  });
});

describe('executeProspectEnrichmentBatch', () => {
  const planPorts = (): EnrichmentPorts => ({
    async loadSnapshot(_org, prospectId) {
      if (prospectId === 'missing') return null;
      return snapshot(Number(prospectId.replace(/\D/g, '')) || 1);
    },
    async loadIntegrations() { return []; },
    async loadConflicts() { return []; },
    async persist() { return { canonicalWithheld: [] }; },
  });
  const base = (hz: ReturnType<typeof harness>, over: Record<string, unknown> = {}) => ({
    organizationId: ORG,
    sourceId: 'clearbit',
    maxProviderCalls: 10,
    now: NOW,
    statuses: [status()],
    planPorts: planPorts(),
    ports: hz.ports,
    adapter: hz.adapter,
    recorder: hz.recorder as never,
    prospectIds: ['lead-1'],
    ...over,
  });

  it('one call per prospect per subject, with every planned attribute in it', async () => {
    const hz = harness();
    const r = await executeProspectEnrichmentBatch(base(hz, { prospectIds: ['lead-1', 'lead-2'] }));
    expect(hz.calls).toHaveLength(2);
    for (const c of hz.calls) expect([...c.attributes].sort()).toEqual(['employee_count', 'founded_year']);
    expect(r.providerCalls).toBe(2);
    expect(r.budgetExhausted).toBe(false);
    expect(r.rows.filter((x) => x.subject === 'account').map((x) => x.status)).toEqual(['executed', 'executed']);
    // The source covers no person attribute, so nothing is planned, and nothing is spent.
    expect(r.rows.filter((x) => x.subject === 'person').map((x) => x.status)).toEqual(['nothing_planned', 'nothing_planned']);
  });

  it('stops at the budget and reports the rest as skipped_budget, never silently', async () => {
    const hz = harness();
    const r = await executeProspectEnrichmentBatch(base(hz, {
      prospectIds: ['lead-1', 'lead-2', 'lead-3'], maxProviderCalls: 1, subjects: ['account'],
    }));
    expect(hz.calls).toHaveLength(1);
    expect(r.budgetExhausted).toBe(true);
    expect(r.rows.map((x) => [x.prospectId, x.status])).toEqual([
      ['lead-1', 'executed'], ['lead-2', 'skipped_budget'], ['lead-3', 'skipped_budget'],
    ]);
  });

  it('a provider that throws is the executor\'s outcome, and it counts against the budget', async () => {
    const hz = harness({ throwOnCall: 1 });
    const r = await executeProspectEnrichmentBatch(base(hz, {
      prospectIds: ['lead-1', 'lead-2'], maxProviderCalls: 1, subjects: ['account'],
    }));
    expect(r.rows[0]).toMatchObject({ status: 'executed', outcome: 'provider_unavailable', providerCalled: true });
    expect(r.rows[1].status).toBe('skipped_budget');
  });

  it('a lost attempt row fails that row before egress, spends no budget, and reports only the error NAME', async () => {
    const hz = harness();
    hz.recorder.record = async () => { throw new RangeError('synthetic ledger failure jane@example.com'); };
    const r = await executeProspectEnrichmentBatch(base(hz, {
      prospectIds: ['lead-1', 'lead-2'], maxProviderCalls: 1, subjects: ['account'],
    }));
    expect(r.rows[0]).toEqual({ prospectId: 'lead-1', subject: 'account', status: 'failed', error: 'AttemptRecordRequiredError' });
    expect(hz.calls).toHaveLength(0); // requireAttemptRecord: no row, no egress
    expect(r.providerCalls).toBe(0);
    expect(r.rows[1].status).toBe('failed'); // same ledger failure, still no spend
    expect(JSON.stringify(r)).not.toContain('jane@');
  });

  it('refuses a run with no source, no prospects, too many prospects or no budget', async () => {
    const hz = harness();
    await expect(executeProspectEnrichmentBatch(base(hz, { sourceId: ' ' }))).rejects.toThrow('sourceId');
    await expect(executeProspectEnrichmentBatch(base(hz, { prospectIds: [] }))).rejects.toThrow('prospectId');
    await expect(executeProspectEnrichmentBatch(base(hz, {
      prospectIds: Array.from({ length: MAX_ENRICHMENT_BATCH_PROSPECTS + 1 }, (_, i) => `lead-${i}`),
    }))).rejects.toThrow(`at most ${MAX_ENRICHMENT_BATCH_PROSPECTS}`);
    for (const maxProviderCalls of [0, -1, 1.5, Number.NaN]) {
      await expect(executeProspectEnrichmentBatch(base(hz, { maxProviderCalls }))).rejects.toThrow('maxProviderCalls');
    }
    expect(hz.calls).toHaveLength(0);
  });

  it('the requested budget is clamped to the hard ceiling', async () => {
    const hz = harness();
    const ids = Array.from({ length: MAX_ENRICHMENT_BATCH_PROSPECTS }, (_, i) => `lead-${i + 1}`);
    const r = await executeProspectEnrichmentBatch(base(hz, { prospectIds: ids, maxProviderCalls: 10_000, subjects: ['account'] }));
    expect(r.providerCalls).toBeLessThanOrEqual(MAX_ENRICHMENT_BATCH_PROVIDER_CALLS);
  });

  it('only the named source is executed; another source\'s planned fields are left alone', async () => {
    const hz = harness();
    const r = await executeProspectEnrichmentBatch(base(hz, { sourceId: 'apollo' }));
    expect(hz.calls).toHaveLength(0);
    expect(r.rows.every((x) => x.status === 'nothing_planned')).toBe(true);
  });

  it('duplicate prospect ids are one prospect', async () => {
    const hz = harness();
    await executeProspectEnrichmentBatch(base(hz, { prospectIds: ['lead-1', 'lead-1', ' lead-1 '], subjects: ['account'] }));
    expect(hz.calls).toHaveLength(1);
  });

  it('PREVIEW spends nothing, and the run makes exactly the calls the preview estimated', async () => {
    const hz = harness();
    const input = base(hz, { prospectIds: ['lead-1', 'lead-2'], subjects: ['account'] });
    const est = await previewProspectEnrichmentBatch(input as never);
    expect(hz.calls).toHaveLength(0);
    expect(est.estimatedProviderCalls).toBe(2);
    expect(est.calls.map((c) => c.attributes)).toEqual([['employee_count', 'founded_year'], ['employee_count', 'founded_year']]);
    const run = await executeProspectEnrichmentBatch(input);
    expect(run.providerCalls).toBe(est.estimatedProviderCalls);
  });

  it('the estimate hash is stable for the same input and changes when the allowed attributes change', async () => {
    const hz = harness();
    const a = await previewProspectEnrichmentBatch(base(hz, { prospectIds: ['lead-1'] }) as never);
    const b = await previewProspectEnrichmentBatch(base(hz, { prospectIds: ['lead-1'] }) as never);
    const c = await previewProspectEnrichmentBatch(base(hz, { prospectIds: ['lead-1'], allowedAttributes: { account: ['employee_count'] } }) as never);
    expect(a.estimateHash).toBe(b.estimateHash);
    expect(c.estimateHash).not.toBe(a.estimateHash);
    expect(c.calls[0].attributes).toEqual(['employee_count']);
  });

  it('allowedAttributes narrows the RUN too (one call, only the allowed attribute)', async () => {
    const hz = harness();
    await executeProspectEnrichmentBatch(base(hz, { prospectIds: ['lead-1'], allowedAttributes: { account: ['founded_year'] } }));
    expect(hz.calls).toHaveLength(1);
    expect(hz.calls[0].attributes).toEqual(['founded_year']);
  });
});
