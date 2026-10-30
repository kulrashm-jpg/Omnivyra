/**
 * Prospect provenance (Agent 2) — inbound leads (`createLead`): form, webhook,
 * website capture, manual. Gated by the PI lead-ingestion gate; never affects
 * `createLead`.
 */
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('unexpected direct db access'); } }));

import {
  recordInboundLeadProvenance,
  scheduleInboundLeadProvenance,
  type InboundProvenanceDeps,
} from '../../services/prospectProvenance/ingestion/inboundLeadProvenance';
import {
  getProvenanceIngestionCounters,
  resetProvenanceIngestionCounters,
} from '../../services/prospectProvenance/ingestion/provenanceTelemetry';
import type { SourceContributionInput } from '../../../lib/prospectProvenance/contract';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const NOW = '2026-10-30T12:00:00.000Z';

function harness(opts: { gate?: boolean } = {}) {
  const sourceRecords = new Map<string, string>();
  const prospects = new Map<string, string>(); // org|key -> id
  const contributionKeys = new Set<string>();
  const calls = { upsert: [] as Array<Record<string, unknown>>, resolve: [] as Array<[string, Record<string, unknown>]>, contributions: [] as SourceContributionInput[] };
  const deps: InboundProvenanceDeps = {
    now: () => NOW,
    gate: jest.fn(async () => (opts.gate === false ? { allowed: false, reason: 'global_kill_switch_off' } : { allowed: true, reason: 'tenant_flag:on' })),
    upsertSourceRecord: jest.fn(async (input) => {
      calls.upsert.push(input);
      const k = `${input.organizationId}|${input.provider}|${input.sourceRecordId}`;
      const existed = sourceRecords.has(k);
      if (!existed) sourceRecords.set(k, `sr-${sourceRecords.size + 1}`);
      return { id: sourceRecords.get(k)!, outcome: existed ? 'unchanged' : 'created' };
    }),
    resolveProspect: jest.fn(async (org, candidate) => {
      calls.resolve.push([org, candidate]);
      const k = `${org}|${candidate.namespacedExternalLeadKey}`;
      if (prospects.has(k)) return { prospectId: prospects.get(k)!, outcome: 'matched', matchedKey: 'namespaced' as const };
      prospects.set(k, `lead-${prospects.size + 1}`);
      return { prospectId: prospects.get(k)!, outcome: 'created' };
    }),
    recorder: jest.fn(async (input: SourceContributionInput) => {
      const k = `${input.organizationId}|${input.canonicalLeadId}|${input.externalRef}`;
      if (contributionKeys.has(k)) return { status: 'duplicate' as const, role: null };
      contributionKeys.add(k);
      calls.contributions.push(input);
      return { status: 'inserted' as const, id: `c-${contributionKeys.size}`, role: input.leadCreated ? 'originating' as const : 'contributing' as const, roleDowngraded: false };
    }),
  };
  return { deps, calls };
}

const lead = (over: Record<string, unknown> = {}) => ({
  id: 'L1', company_id: ORG_A, unified_person_id: 'up-1', name: 'Jane', email: 'jane@acme.test', phone: null,
  source: 'form_embed', form_id: 'F1', integration_id: null, website_id: 'w-1', visitor_session_id: 'vs-1',
  attribution: { landing_page: 'https://acme.test/pricing', utm_source: 'google' }, consent_state: 'granted',
  is_test: false, created_at: '2026-10-29T09:00:00.000Z', ...over,
});

beforeEach(() => resetProvenanceIngestionCounters());

describe('gate', () => {
  it('closed gate ⇒ skipped, nothing read or written', async () => {
    const { deps, calls } = harness({ gate: false });
    const r = await recordInboundLeadProvenance(ORG_A, lead(), 'inbound_form', deps);
    expect(r).toEqual({ status: 'skipped', reason: 'gate:global_kill_switch_off' });
    expect(calls.upsert).toHaveLength(0);
    expect(calls.resolve).toHaveLength(0);
    expect(calls.contributions).toHaveLength(0);
  });

  it('default gate (no deps) is the real PI gate, closed when ENABLE_LEAD_INGESTION is unset', async () => {
    const prev = process.env.ENABLE_LEAD_INGESTION;
    delete process.env.ENABLE_LEAD_INGESTION;
    try {
      const { deps } = harness();
      const r = await recordInboundLeadProvenance(ORG_A, lead(), 'inbound_form', { ...deps, gate: undefined });
      expect(r).toEqual({ status: 'skipped', reason: 'gate:global_kill_switch_off' });
    } finally {
      if (prev !== undefined) process.env.ENABLE_LEAD_INGESTION = prev;
    }
  });
});

describe('per-mode provenance', () => {
  it.each([
    ['inbound_form', 'inbound_form', 'form'],
    ['inbound_webhook', 'inbound_webhook', 'webhook'],
    ['website', 'website', 'website'],
    ['manual', 'manual', null],
  ] as const)('%s → category %s, platform %s', async (mode, category, platform) => {
    const { deps, calls } = harness();
    await recordInboundLeadProvenance(ORG_A, lead(), mode, deps);
    expect(calls.upsert[0]).toMatchObject({
      organizationId: ORG_A, provider: `lead_${mode}`, entityType: 'person', sourceRecordId: 'L1',
      personId: 'up-1', observedAt: '2026-10-29T09:00:00.000Z',
    });
    expect(calls.resolve[0]).toEqual([ORG_A, expect.objectContaining({
      namespacedExternalLeadKey: 'inbound_person:up-1', source: 'form_embed', personId: 'up-1',
      provenance: { sourceCategory: category, platform, externalRef: 'leads:L1' },
    })]);
    expect(calls.contributions[0]).toMatchObject({
      organizationId: ORG_A, canonicalLeadId: 'lead-1', leadCreated: true, sourceCategory: category, platform,
      externalRef: 'leads:L1', sourceRecordId: 'sr-1', sourceUrl: 'https://acme.test/pricing',
      observedAt: '2026-10-29T09:00:00.000Z',
      evidence: expect.objectContaining({ leadId: 'L1', formId: 'F1', visitorSessionId: 'vs-1' }),
      sourceMetadata: expect.objectContaining({ displaySource: 'form_embed', inboundMode: mode, observedAtBasis: 'source', attribution: { landing_page: 'https://acme.test/pricing', utm_source: 'google' } }),
    });
  });

  it('a second submission by the same person contributes to the same prospect', async () => {
    const { deps, calls } = harness();
    await recordInboundLeadProvenance(ORG_A, lead(), 'inbound_form', deps);
    await recordInboundLeadProvenance(ORG_A, lead({ id: 'L2', form_id: null, integration_id: 'I1', source: 'webhook' }), 'inbound_webhook', deps);
    expect(calls.contributions.map((c) => [c.canonicalLeadId, c.leadCreated, c.sourceCategory, c.externalRef])).toEqual([
      ['lead-1', true, 'inbound_form', 'leads:L1'],
      ['lead-1', false, 'inbound_webhook', 'leads:L2'],
    ]);
  });

  it('idempotent retry of the same lead: one source record, one prospect, one contribution', async () => {
    const { deps, calls } = harness();
    await recordInboundLeadProvenance(ORG_A, lead(), 'inbound_form', deps);
    const again = await recordInboundLeadProvenance(ORG_A, lead(), 'inbound_form', deps);
    expect(again).toEqual({ status: 'duplicate', role: null });
    expect(calls.contributions).toHaveLength(1);
    expect(new Set(calls.upsert.map((u) => u.sourceRecordId)).size).toBe(1);
  });
});

describe('refusals', () => {
  it.each([
    [{ company_id: ORG_B }, 'tenant_mismatch'],
    [{ unified_person_id: null }, 'no_person'],
    [{ id: null }, 'no_lead_id'],
    [{ is_test: true }, 'test_lead'],
  ])('%j → skipped:%s with no writes', async (over, reason) => {
    const { deps, calls } = harness();
    const r = await recordInboundLeadProvenance(ORG_A, lead(over), 'inbound_form', deps);
    expect(r).toEqual({ status: 'skipped', reason });
    expect(calls.upsert).toHaveLength(0);
  });

  it('tenant isolation: identical leads in two tenants never share a prospect', async () => {
    const { deps, calls } = harness();
    await recordInboundLeadProvenance(ORG_A, lead(), 'website', deps);
    await recordInboundLeadProvenance(ORG_B, lead({ company_id: ORG_B }), 'website', deps);
    expect(calls.contributions.map((c) => [c.organizationId, c.canonicalLeadId, c.leadCreated])).toEqual([
      [ORG_A, 'lead-1', true], [ORG_B, 'lead-2', true],
    ]);
  });
});

describe('scheduling never throws to createLead', () => {
  it('a failing step is absorbed, logged and counted', async () => {
    const { deps } = harness();
    deps.upsertSourceRecord = jest.fn(async () => { throw new Error('source_records unavailable'); });
    await expect(scheduleInboundLeadProvenance(ORG_A, lead(), 'inbound_form', deps)).resolves.toBeUndefined();
    expect(getProvenanceIngestionCounters()['inbound_lead:failed']).toBe(1);
  });
});
