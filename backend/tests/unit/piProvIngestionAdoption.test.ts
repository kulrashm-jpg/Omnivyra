/**
 * Prospect provenance (Agent 2) — adoption failures are observable (no silent
 * drop) while staying non-throwing to callers, and `adoptLead` survives the
 * HTTP response on Vercel through the repository keep-alive.
 */
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));
const upsertCanonicalLead = jest.fn();
const appendLeadEvent = jest.fn(async () => undefined);
jest.mock('../../services/leadIntelligence/leadIntelligenceRepository', () => ({
  upsertCanonicalLead: (...a: unknown[]) => upsertCanonicalLead(...a),
  appendLeadEvent: (...a: unknown[]) => appendLeadEvent(...(a as [])),
}));
jest.mock('../../services/identityResolutionService', () => ({ ...jest.requireActual('../../services/identityResolutionService'), resolveUnifiedPerson: jest.fn(async () => ({ unifiedPersonId: 'up-1', matchedBy: 'email' })) }));
const warn = jest.fn();
jest.mock('../../services/logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { adoptLead, adoptLeadAsync } from '../../services/leadIntelligence/leadIntelligenceRuntime';
import { durableLeadIntelligenceSink } from '../../services/leadIntelligence/durableLeadIntelligenceSink';
import { createLeadIntelligenceIngestor } from '../../services/leadIntelligence/leadIntelligenceFacade';
import {
  getProvenanceIngestionCounters,
  resetProvenanceIngestionCounters,
} from '../../services/prospectProvenance/ingestion/provenanceTelemetry';

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

beforeEach(() => {
  resetProvenanceIngestionCounters();
  warn.mockClear();
  upsertCanonicalLead.mockReset();
  appendLeadEvent.mockClear();
});

describe('no silent drop', () => {
  it('a sink write that returns no row is surfaced: counted + logged, caller unaffected', async () => {
    upsertCanonicalLead.mockResolvedValue(null);
    await expect(adoptLeadAsync('website', { id: 'L1', company_id: 'co-1', email: 'a@b.test' })).resolves.toBeUndefined();
    expect(getProvenanceIngestionCounters()['lead_adoption:failed']).toBe(1);
    expect(warn).toHaveBeenCalledWith('prospect_provenance_side_effect_failed', expect.objectContaining({
      path: 'lead_adoption', outcome: 'failed', source: 'website', organizationId: 'co-1', sourceRowId: 'L1',
    }));
    expect(appendLeadEvent).not.toHaveBeenCalled();
  });

  it('a row with no tenant is counted as a failure, never written', async () => {
    await adoptLeadAsync('marketpulse', { id: 'm1', title: 'x' });
    expect(getProvenanceIngestionCounters()['lead_adoption:failed']).toBe(1);
    expect(upsertCanonicalLead).not.toHaveBeenCalled();
  });

  it('success is counted and the timeline event is still appended', async () => {
    upsertCanonicalLead.mockResolvedValue({ id: 'li-1' });
    await adoptLeadAsync('website', { id: 'L1', company_id: 'co-1', email: 'a@b.test' });
    expect(getProvenanceIngestionCounters()['lead_adoption:succeeded']).toBe(1);
    expect(appendLeadEvent).toHaveBeenCalledTimes(1);
  });

  it('the durable sink throws on a dropped write (it used to return silently)', async () => {
    upsertCanonicalLead.mockResolvedValue(null);
    const ingestor = createLeadIntelligenceIngestor({ sink: durableLeadIntelligenceSink, identity: { resolve: async () => ({ unifiedPersonId: null }) } });
    await expect(ingestor.ingestFromSource('website', { id: 'L1', company_id: 'co-1' })).rejects.toThrow(/lead_intelligence upsert returned no row/);
  });
});

describe('keep-alive on Vercel', () => {
  const g = globalThis as unknown as Record<symbol, unknown>;
  const prevVercel = process.env.VERCEL;
  afterEach(() => {
    delete g[REQUEST_CONTEXT];
    if (prevVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = prevVercel;
  });

  it("adoptLead hands its work to the request's waitUntil and never throws", async () => {
    upsertCanonicalLead.mockResolvedValue({ id: 'li-1' });
    const handed: Array<Promise<unknown>> = [];
    process.env.VERCEL = '1';
    g[REQUEST_CONTEXT] = { get: () => ({ waitUntil: (p: Promise<unknown>) => handed.push(p) }) };

    expect(() => adoptLead('website', { id: 'L1', company_id: 'co-1', email: 'a@b.test' })).not.toThrow();
    expect(handed).toHaveLength(1);
    await handed[0];
    expect(upsertCanonicalLead).toHaveBeenCalledTimes(1);
    expect(getProvenanceIngestionCounters()['lead_adoption:succeeded']).toBe(1);
  });

  it('off Vercel it still runs detached and completes', async () => {
    delete process.env.VERCEL;
    upsertCanonicalLead.mockResolvedValue({ id: 'li-1' });
    adoptLead('website', { id: 'L1', company_id: 'co-1', email: 'a@b.test' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(upsertCanonicalLead).toHaveBeenCalledTimes(1);
  });
});
