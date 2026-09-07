/**
 * A6 F-1 — the production boundary's mandatory safety configuration.
 *
 * THE GAP THIS CLOSES
 * `executeProspectEnrichment` passes `requireAttemptRecord: true` to the
 * canonical executor. That single property is what stands between the new
 * production route and the defect A4J closed: without it the recorder fails
 * OPEN, so a lost attempt row becomes an unrecorded paid call — two provider
 * calls against one attempt row, understating the tenant's spend in exactly the
 * case an automated caller creates.
 *
 * The A6 P0 #5 integration audit found the line correct but unguarded: the route
 * test mocks `executeProspectEnrichment` wholesale and so cannot see the flag,
 * and no other test observed it. Deleting it would have passed all 427 tests.
 *
 * WHAT IS PROVEN HERE, AND HOW
 * Not by reading the source — by observing the invocation contract at the seam.
 * `executePlannedField` is mocked so the arguments the boundary actually sends
 * are captured, and the last block demonstrates the failure mode itself: with
 * the flag the provider is never entered when the attempt cannot be recorded,
 * and without it the provider IS entered. That contrast is what makes this a
 * guard rather than a restatement — it fails if the value is removed, flipped,
 * or stops being forwarded.
 *
 * Scope: guarding existing behaviour. No executor, port, state, suppression,
 * cost, lease or retry-horizon change. No real provider request.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({}) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

const PLAN = {
  version: 'test.1',
  organizationId: 'org-1',
  prospectId: 'prospect-1',
  toEnrich: [],
  fields: [
    { attribute: 'employee_count', subject: 'account', action: 'enrich', source: 'clearbit', state: 'missing', reason: 'absent', requiredForNextAction: false, sourceStatus: 'available', cost: { kind: 'unknown' } },
    { attribute: 'title', subject: 'person', action: 'skip', source: null, state: 'fresh', reason: 'already fresh', requiredForNextAction: false, sourceStatus: null, cost: { kind: 'unknown' } },
  ],
};
const SNAPSHOT = { personId: 'p-1', accountId: 'a-1', person: {}, account: {} };

const plan = jest.fn(async () => ({ plan: PLAN, snapshot: SNAPSHOT }));
jest.mock('../../services/enrichment/service', () => ({
  planProspectEnrichment: (...args: unknown[]) => plan(...(args as [])),
}));

const executeField = jest.fn(async () => ({ executed: true, outcome: 'enriched' }));
jest.mock('../../services/enrichment/execution', () => ({
  executePlannedField: (...args: unknown[]) => executeField(...(args as [])),
}));

import {
  executeProspectEnrichment,
  defaultExecuteEnrichmentPorts,
} from '../../apiHandlers/prospects/prospectIntelligenceRead';
import { executeEnrichmentRecorded } from '../../services/enrichment/recordedExecution';
import { defaultFindRecentObservation } from '../../services/enrichment/providers';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers';

const run = () => executeProspectEnrichment({
  organizationId: 'org-1',
  prospectId: 'prospect-1',
  attribute: 'employee_count',
  subject: 'account',
  now: '2026-09-07T00:00:00.000Z',
});

/** The first argument the boundary handed to the canonical executor. */
const sentInput = () => (executeField.mock.calls[0] as unknown as Array<Record<string, unknown>>)[0];
/** The port set the boundary handed to the canonical executor. */
const sentPorts = () => (executeField.mock.calls[0] as unknown as Array<ExecuteEnrichmentPorts>)[1];

beforeEach(() => {
  jest.clearAllMocks();
  plan.mockImplementation(async () => ({ plan: PLAN, snapshot: SNAPSHOT }));
  executeField.mockImplementation(async () => ({ executed: true, outcome: 'enriched' } as never));
});

describe('A6 F-1 — the production boundary must not execute fail-open', () => {
  // ── The guard itself ──────────────────────────────────────────────────────
  describe('requireAttemptRecord reaches the canonical execution seam', () => {
    it('is sent as exactly true — not absent, not false', async () => {
      await run();
      // Deleting the property, or setting it to false, fails here. So does
      // ceasing to forward it, because the seam would then receive undefined.
      expect(sentInput().requireAttemptRecord).toBe(true);
      expect(sentInput().requireAttemptRecord).not.toBe(false);
      expect(sentInput()).toHaveProperty('requireAttemptRecord');
    });

    it('invokes the canonical executor exactly once', async () => {
      await run();
      expect(executeField).toHaveBeenCalledTimes(1);
    });

    it('hands over the real production port set, not a substitute', async () => {
      await run();
      // Ties this boundary to the composition guard: the flag protects attempt
      // recording, and this protects the suppression read it runs alongside.
      expect(sentPorts().findRecentObservation).toBe(defaultFindRecentObservation);
      expect(sentPorts().findRecentObservation).toBe(defaultExecuteEnrichmentPorts().findRecentObservation);
    });
  });

  // ── The middle link: planning → caller-named field → executor ─────────────
  describe('the middle link selects the caller-named field and passes the verdict through', () => {
    it('selects the attribute the caller named, not one it chose', async () => {
      await run();
      const field = sentInput().field as Record<string, unknown>;
      expect(field.attribute).toBe('employee_count');
      expect(field.subject).toBe('account');
    });

    it('passes the planner result through unchanged', async () => {
      await run();
      // Same object, so no re-derivation, re-planning or mutation can hide here.
      expect(sentInput().plan).toBe(PLAN);
      expect(sentInput().snapshot).toBe(SNAPSHOT);
      expect(sentInput().field).toBe(PLAN.fields[0]);
    });

    it('plans exactly once, for the tenant and prospect it was given', async () => {
      await run();
      expect(plan).toHaveBeenCalledTimes(1);
      const arg = (plan.mock.calls[0] as unknown as Array<Record<string, unknown>>)[0];
      expect(arg.organizationId).toBe('org-1');
      expect(arg.prospectId).toBe('prospect-1');
    });

    it('refuses without executing when the planner did not mark the field for enrichment', async () => {
      const out = await executeProspectEnrichment({
        organizationId: 'org-1', prospectId: 'prospect-1',
        attribute: 'title', subject: 'person',
        now: '2026-09-07T00:00:00.000Z',
      });
      expect(out).toEqual({ status: 'not_planned', reason: 'skip: already fresh' });
      expect(executeField).not.toHaveBeenCalled();   // the planner's verdict is final
    });

    it('refuses without executing when the attribute is not in the plan at all', async () => {
      const out = await executeProspectEnrichment({
        organizationId: 'org-1', prospectId: 'prospect-1',
        attribute: 'revenue', subject: 'account',
        now: '2026-09-07T00:00:00.000Z',
      });
      expect(out).toMatchObject({ status: 'not_planned' });
      expect(executeField).not.toHaveBeenCalled();
    });
  });

  // ── The failure mode the flag exists to prevent ──────────────────────────
  describe('the configured value is load-bearing, not decorative', () => {
    const request = {
      organizationId: 'org-1', subject: 'account' as const, entityId: 'a-1',
      attributes: ['employee_count'], identity: { domain: 'northwind.test' },
      purpose: 'test', correlationId: 'corr-1',
    };
    const ports = (): ExecuteEnrichmentPorts => ({
      async authorizeCost() { return { authorized: true, holdId: null, cost: { kind: 'unknown' } }; },
      async releaseCost() { /* nothing reserved */ },
      async resolveCredential() { return 'test-only-not-a-credential'; },
      async findRecentObservation() { return null; },
      async persistObservation() { return { sourceRecordId: 'sr-1', canonicalWithheld: [] }; },
      now: () => '2026-09-07T00:00:00.000Z',
    });
    // The attempt row cannot be established — the concurrent-collision case.
    const failingRecorder = () => ({
      record: async () => { throw new Error('duplicate key value violates unique constraint'); },
      nextNumber: async () => 1,
      markPending: async () => { /* unreached */ },
      complete: async () => { /* unreached */ },
    });
    const countingAdapter = (calls: string[]) => ({
      id: 'clearbit', supports: ['employee_count'],
      async enrich() { calls.push('egress'); return { outcome: 'enriched', fields: [], notReturned: [] }; },
    });

    it('with the production value, an unrecordable attempt produces NO provider egress', async () => {
      const calls: string[] = [];
      await expect(executeEnrichmentRecorded(request as never, 'clearbit', ports(), {
        adapter: countingAdapter(calls) as never,
        recorder: failingRecorder() as never,
        requireAttemptRecord: true,           // what the production boundary sends
      })).rejects.toThrow();
      expect(calls).toEqual([]);              // the tenant was never billed
    });

    it('without it the provider IS contacted — which is why the value must be guarded', async () => {
      const calls: string[] = [];
      await executeEnrichmentRecorded(request as never, 'clearbit', ports(), {
        adapter: countingAdapter(calls) as never,
        recorder: failingRecorder() as never,
        requireAttemptRecord: false,          // the fail-open default
      });
      // A paid call with no attempt row. Correct for a user-initiated action,
      // and precisely what must never happen on the production boundary.
      expect(calls).toEqual(['egress']);
    });
  });
});
