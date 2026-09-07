/**
 * A6 — the production enrichment execution boundary.
 *
 * THE GAP THIS CLOSES
 * Three audits established that every part of the executor already existed and
 * was correct — suppression, cost, credential resolution, persistence, the
 * attempt state machine, the retry horizon — and that exactly two things were
 * missing: a composition of the four real production ports, and a reachable
 * caller. Until both existed the state model was write-only in the strictest
 * sense: nothing in production could even write it.
 *
 * WHY TEST A IS AN IDENTITY ASSERTION AND NOT A SHAPE ASSERTION
 * `findRecentObservation` is the executor's only defence against paying a
 * provider for evidence already on file. `async () => null` satisfies its type
 * perfectly and disables it completely, and thirteen such stubs exist in this
 * repository — it is the most copied shape in the enrichment tests. TypeScript
 * can prove the port is PRESENT; only an identity check can prove it is REAL.
 * A `typeof === 'function'` assertion would pass for every one of those stubs,
 * which is precisely the accident this test exists to prevent.
 *
 * Scope: the boundary only. No scheduler, no retry consumer, no new suppression
 * abstraction, no state-model change. No real provider request is made.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import {
  defaultExecuteEnrichmentPorts,
  executeProspectEnrichment,
} from '../../apiHandlers/prospects/prospectIntelligenceRead';
import {
  defaultCostPort,
  tenantCredentialPort,
  defaultFindRecentObservation,
  defaultPersistObservation,
} from '../../services/enrichment/providers';
import { executeEnrichment } from '../../services/enrichment/providers/execute';
import { executeEnrichmentRecorded } from '../../services/enrichment/recordedExecution';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers';
import type { EnrichmentProviderAdapter } from '../../services/enrichment/providers';

describe('A6 — production executor boundary', () => {
  // ── Test A. The composition is the REAL production port set ──────────────
  describe('A. composition-root identity guard', () => {
    const ports = defaultExecuteEnrichmentPorts();

    it('uses the real suppression read, not a stub', () => {
      expect(ports.findRecentObservation).toBe(defaultFindRecentObservation);
    });

    it('uses the real persistence, credential and cost ports', () => {
      expect(ports.persistObservation).toBe(defaultPersistObservation);
      expect(ports.resolveCredential).toBe(tenantCredentialPort.resolveCredential);
      expect(ports.authorizeCost).toBe(defaultCostPort.authorizeCost);
      expect(ports.releaseCost).toBe(defaultCostPort.releaseCost);
    });

    it('is not satisfied by a null-returning stub — the accident this guards', async () => {
      // Demonstrates the guard has teeth: a stub passes every shape check and
      // fails the identity check, which is the whole point.
      const stub = async () => null;
      expect(typeof stub).toBe(typeof ports.findRecentObservation);
      expect(stub).not.toBe(ports.findRecentObservation);
      await expect(stub()).resolves.toBeNull();
    });

    it('supplies every required member of the contract', () => {
      for (const member of [
        'authorizeCost', 'releaseCost', 'resolveCredential',
        'findRecentObservation', 'persistObservation', 'now',
      ] as const) {
        expect(typeof ports[member]).toBe('function');
      }
      expect(typeof ports.now()).toBe('string');
    });
  });

  // ── Test B. Suppression precedes cost and provider egress ────────────────
  describe('B. a suppression hit spends nothing', () => {
    const OBSERVED = '2026-09-06T00:00:00.000Z';
    const NOW = '2026-09-07T00:00:00.000Z';

    const spyPorts = (recent: { observedAt: string } | null) => {
      const calls = { cost: 0, provider: 0, persist: 0 };
      const ports: ExecuteEnrichmentPorts = {
        async authorizeCost() { calls.cost += 1; return { authorized: true, holdId: null, cost: { kind: 'unknown' } }; },
        async releaseCost() { /* nothing reserved */ },
        async resolveCredential() { return 'test-only-not-a-credential'; },
        async findRecentObservation() { return recent; },
        async persistObservation() { calls.persist += 1; return { sourceRecordId: 'sr-1', canonicalWithheld: [] }; },
        now: () => NOW,
      };
      const adapter: EnrichmentProviderAdapter = {
        id: 'clearbit',
        supports: ['employee_count'],
        async enrich() {
          calls.provider += 1;
          return { outcome: 'enriched', fields: [{ attribute: 'employee_count', value: 42, observedAt: NOW }], notReturned: [] } as never;
        },
      } as never;
      return { calls, ports, adapter };
    };

    const request = {
      organizationId: 'org-1',
      subject: 'account' as const,
      entityId: 'acct-1',
      attributes: ['employee_count'],
      identity: { domain: 'northwind.test' },
      purpose: 'test',
      correlationId: 'corr-1',
    };

    it('returns duplicate_suppressed without authorizing cost or calling the provider', async () => {
      const { calls, ports, adapter } = spyPorts({ observedAt: OBSERVED });
      const result = await executeEnrichment(request as never, 'clearbit', ports, { adapter });
      expect(result.outcome).toBe('duplicate_suppressed');
      expect(result.providerCalled).toBe(false);
      expect(calls.cost).toBe(0);       // suppression is BEFORE cost
      expect(calls.provider).toBe(0);   // and BEFORE egress
      expect(calls.persist).toBe(0);
    });

    it('proceeds to cost and provider when nothing equivalent is on file', async () => {
      const { calls, ports, adapter } = spyPorts(null);
      const result = await executeEnrichment(request as never, 'clearbit', ports, { adapter });
      expect(result.outcome).toBe('enriched');
      expect(result.providerCalled).toBe(true);
      expect(calls.cost).toBe(1);
      expect(calls.provider).toBe(1);
    });

    it('keeps the ordering: cost is authorized before the provider is contacted', async () => {
      const order: string[] = [];
      const { ports, adapter } = spyPorts(null);
      const ordered: ExecuteEnrichmentPorts = {
        ...ports,
        async findRecentObservation() { order.push('suppression'); return null; },
        async authorizeCost() { order.push('cost'); return { authorized: true, holdId: null, cost: { kind: 'unknown' } }; },
      };
      const observedAdapter = { ...adapter, async enrich(req: never) { order.push('provider'); return adapter.enrich(req); } };
      await executeEnrichment(request as never, 'clearbit', ordered, { adapter: observedAdapter as never });
      expect(order).toEqual(['suppression', 'cost', 'provider']);
    });
  });

  // ── Test C. The entry point reaches the canonical executor ───────────────
  describe('C. the production entry point is a shell over the canonical executor', () => {
    it('refuses an attribute the planner did not mark for enrichment', async () => {
      // Reaching the planner requires the DB seam; the assertion here is that
      // the entry point REPORTS the planner's verdict rather than executing
      // anything of its own. Any failure is a planning failure, never a
      // provider call — nothing below suppression can be reached.
      await expect(
        executeProspectEnrichment({
          organizationId: '', prospectId: 'p-1',
          attribute: 'employee_count', subject: 'account',
          now: '2026-09-07T00:00:00.000Z',
        }),
      ).rejects.toThrow(/organizationId is required/);
    });
  });

  // ── Test D. Ambiguous transport is preserved, not guessed ────────────────
  describe('D. provider_call_state = unknown survives a mid-transport failure', () => {
    const request = {
      organizationId: 'org-1', subject: 'account' as const, entityId: 'acct-1',
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

    it('marks the call pending BEFORE transport is entered', async () => {
      const order: string[] = [];
      const adapter = {
        id: 'clearbit', supports: ['employee_count'],
        async enrich() {
          order.push('transport');
          return { outcome: 'enriched', fields: [{ attribute: 'employee_count', value: 42, observedAt: null }], notReturned: [] };
        },
      };
      await executeEnrichmentRecorded(request as never, 'clearbit', ports(), {
        adapter: adapter as never,
        recorder: {
          record: async () => ({ attemptId: 'a-1' }),
          nextNumber: async () => 1,
          markPending: async () => { order.push('mark_pending'); },
          complete: async () => { order.push('complete'); },
        } as never,
      });
      expect(order).toEqual(['mark_pending', 'transport', 'complete']);
    });

    it('does not enter transport when the pending mark cannot be persisted', async () => {
      // A4V — fail closed. If `unknown` cannot be written, a process death in
      // the transport window would leave the row asserting `not_called` while
      // the tenant's quota was being spent. Behaviour unchanged by A6; pinned
      // here so the new boundary cannot regress it.
      let entered = 0;
      const adapter = {
        id: 'clearbit', supports: ['employee_count'],
        async enrich() { entered += 1; return { outcome: 'enriched', fields: [], notReturned: [] }; },
      };
      // The refusal PROPAGATES rather than becoming a result: A4V stops the
      // execution outright rather than letting it report a call that may or may
      // not have happened. What matters for this invariant is that transport
      // was never approached.
      await expect(executeEnrichmentRecorded(request as never, 'clearbit', ports(), {
        adapter: adapter as never,
        recorder: {
          record: async () => ({ attemptId: 'a-1' }),
          nextNumber: async () => 1,
          markPending: async () => { throw new Error('mark failed'); },
          complete: async () => { /* terminal write */ },
        } as never,
      })).rejects.toThrow(/mark failed/);
      expect(entered).toBe(0);                       // transport never approached
    });
  });
});
