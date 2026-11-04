/**
 * Prospect provenance (Agent 2) — adoption failures are observable (no silent
 * drop) while staying non-throwing to callers, and `adoptLead` survives the
 * HTTP response on Vercel through the repository keep-alive.
 */
// Type-only, so it is ERASED and cannot disturb the `jest.mock` hoisting the
// rest of this header depends on. It is here because the mocks below must be
// typed against the real contract rather than against whatever their first
// literal happens to infer.
import type { LeadProjectionResult } from '../../../lib/leadIntelligence';

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));
const upsertCanonicalLead = jest.fn();
// The verdict-returning sibling the sink actually calls. Defaults to a refusal
// so the "dropped write" cases below exercise the real classification path.
//
// The return type is DECLARED, not inferred. Without it, `jest.fn` narrowed the
// resolved type to this exact literal — `status: 'failed'`, `reason:
// 'write_failed'` — and every later `mockResolvedValue` with a different status
// or reason was a type error: `'persisted'` is not assignable to `'failed'`.
// Six such errors sat in this file while the suite passed 6/6, because ts-jest
// is transpile-only and no typecheck config covers backend/tests. The rest
// parameter is what makes `upsertCanonicalLeadWithOutcome(...a)` below legal
// for an `unknown[]` spread; the previous zero-arg signature was not.
const upsertCanonicalLeadWithOutcome = jest.fn(async (..._args: unknown[]): Promise<LeadProjectionResult> => ({
  status: 'failed',
  leadId: null,
  reason: 'write_failed',
  warnings: [],
  error: 'lead_intelligence upsert returned no row',
}));
const appendLeadEvent = jest.fn(async () => undefined);
// `upsertCanonicalLeadWithOutcome` is REQUIRED here, not optional.
//
// This mock listed only two exports. The sink now calls a third, so with an
// incomplete double it threw `TypeError: ... is not a function` — and because
// `adoptLeadAsync` counts ANY throw as `lead_adoption:failed`, the "no silent
// drop" test below went green off the TypeError while three sibling tests went
// red. The suite that exists to prove the telemetry fires could no longer tell
// a classified projection failure from the sink module exploding.
jest.mock('../../services/leadIntelligence/leadIntelligenceRepository', () => ({
  upsertCanonicalLead: (...a: unknown[]) => upsertCanonicalLead(...a),
  upsertCanonicalLeadWithOutcome: (...a: unknown[]) => upsertCanonicalLeadWithOutcome(...a),
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
  // Reset AND restore the default refusal: a bare mockReset() would leave it
  // returning undefined, which the sink would read as a missing verdict.
  upsertCanonicalLeadWithOutcome.mockReset();
  upsertCanonicalLeadWithOutcome.mockResolvedValue({
    status: 'failed', leadId: null, reason: 'write_failed', warnings: [],
    error: 'lead_intelligence upsert returned no row',
  });
  appendLeadEvent.mockClear();
});

describe('no silent drop', () => {
  it('a sink write that returns no row is surfaced: counted + logged, caller unaffected', async () => {
    // Arranged on the verdict function, which is what the sink calls. This line
    // used to set `upsertCanonicalLead` and was dead: the counter below was
    // reached by a TypeError from an incomplete mock, not by a classified failure.
    upsertCanonicalLeadWithOutcome.mockResolvedValue({
      status: 'failed', leadId: null, reason: 'schema_not_applied',
      warnings: [], error: 'column "display" of relation "lead_intelligence" does not exist',
    });
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
    expect(upsertCanonicalLeadWithOutcome).not.toHaveBeenCalled();
  });

  it('success is counted and the timeline event is still appended', async () => {
    upsertCanonicalLeadWithOutcome.mockResolvedValue({
      status: 'persisted', leadId: 'li-1', reason: null, warnings: [], error: null,
    });
    await adoptLeadAsync('website', { id: 'L1', company_id: 'co-1', email: 'a@b.test' });
    expect(getProvenanceIngestionCounters()['lead_adoption:succeeded']).toBe(1);
    expect(appendLeadEvent).toHaveBeenCalledTimes(1);
  });

  it('the durable sink throws on a dropped write (it used to return silently)', async () => {
    const ingestor = createLeadIntelligenceIngestor({ sink: durableLeadIntelligenceSink, identity: { resolve: async () => ({ unifiedPersonId: null }) } });
    const err = await ingestor.ingestFromSource('website', { id: 'L1', company_id: 'co-1' }).catch((e: unknown) => e);
    // Still throws, so main's `adoptLeadAsync` catch still counts it. The message
    // assertion is kept, but the CLASSIFIED verdict is now asserted too — a
    // message pin alone could not tell this apart from the sink module throwing
    // a TypeError, which is exactly how this suite went green while broken.
    expect(String(err)).toMatch(/lead_intelligence upsert returned no row/);
    expect((err as { result?: { status?: string; reason?: string } }).result?.status).toBe('failed');
    expect((err as { result?: { status?: string; reason?: string } }).result?.reason).toBe('write_failed');
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
    upsertCanonicalLeadWithOutcome.mockResolvedValue({
      status: 'persisted', leadId: 'li-1', reason: null, warnings: [], error: null,
    });
    const handed: Array<Promise<unknown>> = [];
    process.env.VERCEL = '1';
    g[REQUEST_CONTEXT] = { get: () => ({ waitUntil: (p: Promise<unknown>) => handed.push(p) }) };

    expect(() => adoptLead('website', { id: 'L1', company_id: 'co-1', email: 'a@b.test' })).not.toThrow();
    expect(handed).toHaveLength(1);
    await handed[0];
    expect(upsertCanonicalLeadWithOutcome).toHaveBeenCalledTimes(1);
    expect(getProvenanceIngestionCounters()['lead_adoption:succeeded']).toBe(1);
  });

  it('off Vercel it still runs detached and completes', async () => {
    delete process.env.VERCEL;
    upsertCanonicalLeadWithOutcome.mockResolvedValue({
      status: 'persisted', leadId: 'li-1', reason: null, warnings: [], error: null,
    });
    adoptLead('website', { id: 'L1', company_id: 'co-1', email: 'a@b.test' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(upsertCanonicalLeadWithOutcome).toHaveBeenCalledTimes(1);
  });
});
