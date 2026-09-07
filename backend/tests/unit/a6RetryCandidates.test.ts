/**
 * A6 — retry-candidate eligibility, its index, and attempt-number concurrency.
 *
 * These are scheduler PREREQUISITES, not a scheduler. Nothing here dispatches,
 * loops, claims or executes; the reader selects and the tests hold the rules it
 * selects by.
 *
 * THE RULE UNDER TEST IS DEFAULT-DENY. An attempt is a candidate only when its
 * outcome is explicitly RETRYABLE. Every other outcome — including two that are
 * deliberately left unclassified — is excluded. A false negative leaves visible
 * work undone; a false positive spends a tenant's provider quota answering a
 * question that was already answered. Only one of those is recoverable.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('no production table in this suite'); } }));

import {
  retryClassOf,
  isRetryCandidate,
  listDueRetryCandidates,
  RETRY_CLASS_BY_OUTCOME,
  RETRYABLE_OUTCOMES,
  RETRYABLE_EXECUTION_STATUSES,
} from '../../services/enrichment/retryCandidates';
import { ENRICHMENT_OUTCOMES } from '../../services/enrichment/providers/contract';
import { EXECUTION_STATUSES } from '../../services/enrichment/attempts';

const NOW = '2026-09-07T12:00:00.000Z';
const DUE = '2026-09-07T11:00:00.000Z';
const FUTURE = '2026-09-07T13:00:00.000Z';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'att-1',
  organization_id: 'org-1',
  person_id: null,
  account_id: 'acct-1',
  provider_key: 'clearbit',
  requested_attributes: ['employee_count'],
  attempt_number: 1,
  correlation_id: 'corr-1',
  outcome: 'rate_limited',
  execution_status: 'completed',
  provider_call_state: 'called',
  completed_at: DUE,
  next_retry_at: DUE,
  ...over,
});

/** A PostgREST-shaped chain that records every predicate it was given. */
const capturingQuery = (rows: unknown[], captured: Record<string, unknown>) => {
  const chain: Record<string, unknown> = {};
  const record = (key: string) => (...args: unknown[]) => {
    const list = (captured[key] as unknown[]) ?? [];
    list.push(args);
    captured[key] = list;
    return chain;
  };
  chain.eq = record('eq');
  chain.not = record('not');
  chain.lte = record('lte');
  chain.in = record('in');
  chain.neq = record('neq');
  chain.order = record('order');
  chain.limit = (n: number) => { captured.limit = n; return Promise.resolve({ data: rows, error: null }); };
  return (columns: string) => { captured.columns = columns; return chain as never; };
};

const listWith = async (rows: unknown[], over: Record<string, unknown> = {}) => {
  const captured: Record<string, unknown> = {};
  const out = await listDueRetryCandidates({
    organizationId: 'org-1', now: NOW, query: capturingQuery(rows, captured) as never, ...over,
  });
  return { out, captured };
};

describe('A6 — retry candidates', () => {
  // ── Workstream A: the classification ──────────────────────────────────────
  describe('A. every existing outcome is classified, and unlisted means never', () => {
    it('classifies all 13 outcomes with no gaps', () => {
      for (const outcome of ENRICHMENT_OUTCOMES) {
        expect(RETRY_CLASS_BY_OUTCOME[outcome]).toBeDefined();
      }
      expect(Object.keys(RETRY_CLASS_BY_OUTCOME).sort()).toEqual([...ENRICHMENT_OUTCOMES].sort());
    });

    it('treats only transient provider-side failures as retryable', () => {
      expect([...RETRYABLE_OUTCOMES].sort())
        .toEqual(['provider_unavailable', 'quota_exceeded', 'rate_limited', 'timeout']);
    });

    it('never retries an answered, suppressed or precondition-blocked outcome', () => {
      expect(retryClassOf('enriched')).toBe('permanent');
      expect(retryClassOf('no_match')).toBe('permanent');
      expect(retryClassOf('field_not_found')).toBe('permanent');
      expect(retryClassOf('not_implemented')).toBe('permanent');
      expect(retryClassOf('duplicate_suppressed')).toBe('suppressed');
      expect(retryClassOf('credential_missing')).toBe('not_yet_eligible');
      expect(retryClassOf('cost_denied')).toBe('not_yet_eligible');
    });

    it('abstains rather than guessing on the two ambiguous outcomes', () => {
      expect(retryClassOf('provider_declined')).toBe('requires_policy');
      expect(retryClassOf('malformed_response')).toBe('requires_policy');
    });

    it('a new or unknown outcome is never retryable by default', () => {
      expect(retryClassOf('something_invented_later')).toBe('requires_policy');
      expect(retryClassOf(null)).toBe('requires_policy');
      expect(retryClassOf(undefined)).toBe('requires_policy');
    });

    it('only terminal execution states can carry a retry', () => {
      expect([...RETRYABLE_EXECUTION_STATUSES].sort()).toEqual(['completed', 'platform_failed']);
      for (const s of EXECUTION_STATUSES) {
        if (!RETRYABLE_EXECUTION_STATUSES.includes(s)) {
          expect(isRetryCandidate(row({ execution_status: s }), NOW)).toBe(false);
        }
      }
    });
  });

  // ── Workstream A: the predicate ───────────────────────────────────────────
  describe('A. eligibility', () => {
    it('accepts a due, completed, retryable attempt', () => {
      expect(isRetryCandidate(row(), NOW)).toBe(true);
    });

    it('excludes a horizon that has not arrived', () => {
      expect(isRetryCandidate(row({ next_retry_at: FUTURE }), NOW)).toBe(false);
    });

    it('excludes an attempt with no horizon at all — NULL is not "retry now"', () => {
      expect(isRetryCandidate(row({ next_retry_at: null }), NOW)).toBe(false);
    });

    it('excludes an unfinished attempt', () => {
      expect(isRetryCandidate(row({ completed_at: null }), NOW)).toBe(false);
    });

    it('excludes permanent, suppressed and precondition-blocked outcomes even when due', () => {
      for (const outcome of ['enriched', 'no_match', 'not_implemented', 'duplicate_suppressed', 'credential_missing', 'cost_denied']) {
        expect(isRetryCandidate(row({ outcome }), NOW)).toBe(false);
      }
    });

    it('excludes uncertain transport — that is a spend decision, not a schedule', () => {
      expect(isRetryCandidate(row({ provider_call_state: 'unknown' }), NOW)).toBe(false);
      // The same attempt with certain transport IS a candidate, so the exclusion
      // is the call-state and nothing else.
      expect(isRetryCandidate(row({ provider_call_state: 'called' }), NOW)).toBe(true);
      expect(isRetryCandidate(row({ provider_call_state: 'not_called' }), NOW)).toBe(true);
    });
  });

  // ── Workstream A: the read ────────────────────────────────────────────────
  describe('A. the reader applies the tenant and the rule', () => {
    it('returns a due candidate with its full work-item lineage', async () => {
      const { out } = await listWith([row()]);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        attemptId: 'att-1', organizationId: 'org-1', subject: 'account', entityId: 'acct-1',
        providerKey: 'clearbit', requestedAttributes: ['employee_count'], attemptNumber: 1,
        outcome: 'rate_limited', nextRetryAt: DUE,
      });
    });

    it('reports person subjects from the person column', async () => {
      const { out } = await listWith([row({ person_id: 'p-1', account_id: null })]);
      expect(out[0]).toMatchObject({ subject: 'person', entityId: 'p-1' });
    });

    it('scopes to the tenant as the first predicate, and refuses without one', async () => {
      const { captured } = await listWith([row()]);
      expect((captured.eq as unknown[][])[0]).toEqual(['organization_id', 'org-1']);
      await expect(listDueRetryCandidates({ organizationId: '  ', now: NOW })).rejects.toThrow(/organizationId is required/);
      await expect(listDueRetryCandidates({ organizationId: 'org-1', now: '' })).rejects.toThrow(/now is required/);
    });

    it('re-applies the rule to returned rows, so a widened query cannot leak', async () => {
      // The stub ignores the predicates and returns ineligible rows anyway.
      const { out } = await listWith([
        row({ outcome: 'enriched' }),
        row({ provider_call_state: 'unknown' }),
        row({ next_retry_at: FUTURE }),
        row({ id: 'keep' }),
      ]);
      expect(out.map((r) => r.attemptId)).toEqual(['keep']);
    });

    it('orders by the horizon and bounds the page', async () => {
      const { captured } = await listWith([row()], { limit: 7 });
      expect((captured.order as unknown[][])[0]).toEqual(['next_retry_at', { ascending: true }]);
      expect(captured.limit).toBe(7);
    });
  });

  // ── Workstream B: the query shape matches the proposed index ─────────────
  describe('B. the query shape the index is built for', () => {
    const fs = require('fs');
    const path = require('path');
    const migration = fs.readFileSync(
      path.join(__dirname, '../../../supabase/migrations/20261021000000_pi_attempt_retry_due_index.sql'), 'utf8');

    it('issues exactly the predicate the index leads on', async () => {
      const { captured } = await listWith([row()]);
      expect((captured.eq as unknown[][])[0][0]).toBe('organization_id');   // equality, leads
      expect((captured.lte as unknown[][])[0][0]).toBe('next_retry_at');    // range, follows
      expect((captured.order as unknown[][])[0][0]).toBe('next_retry_at');  // and serves the sort
    });

    it('proposes one partial index on exactly those columns, in that order', () => {
      expect(migration).toMatch(/\(organization_id, next_retry_at\)/);
      expect(migration).toMatch(/WHERE next_retry_at IS NOT NULL/);
      expect((migration.match(/CREATE INDEX/g) || [])).toHaveLength(1);
    });

    it('does not duplicate an existing access path', () => {
      // No existing index leads on (organization_id, next_retry_at); the three
      // partial ones are `WHERE completed_at IS NULL`, the opposite of a retry.
      const existing = fs.readdirSync(path.join(__dirname, '../../../supabase/migrations'))
        .filter((f: string) => /2026101[5-9]|20261020/.test(f))
        .map((f: string) => fs.readFileSync(path.join(__dirname, '../../../supabase/migrations', f), 'utf8'))
        .join('\n');
      expect(existing).not.toMatch(/\(organization_id, next_retry_at\)/);
    });
  });

  // ── Workstream E: attempt-number concurrency ─────────────────────────────
  describe('E. concurrent workers cannot both hold live work for one item', () => {
    const fs = require('fs');
    const path = require('path');
    const migrations = ['20261015000000_pi_enrichment_attempt_record.sql', '20261016000000_pi_enrichment_attempt_lease.sql',
      '20261017000000_pi_provider_call_state.sql', '20261018000000_pi_attempt_attribute_set_identity.sql']
      .map((f) => { try { return fs.readFileSync(path.join(__dirname, '../../../supabase/migrations', f), 'utf8'); } catch { return ''; } })
      .join('\n');

    it('the database — not application code — is the arbiter, via unique indexes', () => {
      // Two guarantees, both enforced by the DB: one attempt per attempt_number,
      // and at most ONE LIVE attempt per (tenant, entity, provider). The second
      // is what makes `nextAttemptNumber`'s read-then-increment safe: even if
      // two workers compute the same number, only one INSERT survives.
      expect(migrations).toMatch(/UNIQUE INDEX[\s\S]*?\(organization_id, person_id, provider_key, attempt_number\)/);
      expect(migrations).toMatch(/UNIQUE INDEX[\s\S]*?\(organization_id, account_id, provider_key, attempt_number\)/);
      expect(migrations).toMatch(/UNIQUE INDEX[\s\S]*?person_live[\s\S]*?WHERE person_id IS NOT NULL AND completed_at IS NULL/);
      expect(migrations).toMatch(/UNIQUE INDEX[\s\S]*?account_live[\s\S]*?WHERE account_id IS NOT NULL AND completed_at IS NULL/);
    });

    it('a retry candidate names the work item, so a claim can be scoped to it', async () => {
      // A4Y — a claim is per (tenant, entity, provider, attribute SET). The
      // candidate carries all four, so a future claim cannot widen to a
      // different attribute set by accident.
      const { out } = await listWith([row()]);
      const c = out[0];
      expect(c.organizationId).toBe('org-1');
      expect(c.entityId).toBe('acct-1');
      expect(c.providerKey).toBe('clearbit');
      expect(c.requestedAttributes).toEqual(['employee_count']);
    });
  });
});
