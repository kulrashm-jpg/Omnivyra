/**
 * A4A — an enrichment attempt is recorded, and recording it changes nothing else.
 *
 * The A4 audit found the executor safe to call repeatedly but found no evidence
 * anywhere that it had ever run. Without that evidence a maintenance loop
 * cannot know it already failed an hour ago, and what it would spend on the
 * retry is the TENANT'S provider quota. These tests pin the record, and pin
 * equally hard that adding it altered no A3 semantic.
 *
 * The distinction under test throughout: an ATTEMPT is an execution
 * opportunity; a DUPLICATE OBSERVATION is fresh data. `duplicate_suppressed` is
 * a real attempt that contacted nobody — recording it as anything else would
 * make "we already have this" indistinguishable from "we already tried and it
 * failed", which call for opposite next actions.
 *
 * SECRETS: all synthetic. No real credential, no provider call.
 */

const rows: Record<string, unknown>[] = [];
const captured: { op: string; table: string; payload?: unknown; filters?: Record<string, unknown> }[] = [];
let failNextInsert = false;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Record<string, unknown> = {};
    let mode: 'select' | 'insert' | 'update' = 'select';
    let payload: Record<string, unknown> | null = null;
    let order: { col: string; asc: boolean } | null = null;
    let limit = 1000;

    const matches = (r: Record<string, unknown>) =>
      Object.entries(filters).every(([k, v]) => r[k] === v);

    const q: Record<string, unknown> = {};
    q.insert = (p: Record<string, unknown>) => { mode = 'insert'; payload = p; return q; };
    q.update = (p: Record<string, unknown>) => { mode = 'update'; payload = p; return q; };
    q.select = () => q;
    q.eq = (col: string, val: unknown) => { filters[col] = val; return q; };
    q.order = (col: string, o: { ascending: boolean }) => { order = { col, asc: o.ascending }; return q; };
    q.limit = (n: number) => { limit = n; return q; };

    q.single = async () => {
      if (failNextInsert) { failNextInsert = false; return { data: null, error: { message: 'insert exploded' } }; }
      const row = { id: `attempt-${rows.length + 1}`, ...(payload as object) };
      rows.push(row);
      captured.push({ op: 'insert', table, payload });
      return { data: { id: row.id }, error: null };
    };

    // Awaiting the builder resolves select/update.
    q.then = (resolve: (v: unknown) => unknown) => {
      if (mode === 'update') {
        const hit = rows.filter(matches);
        hit.forEach((r) => Object.assign(r, payload));
        captured.push({ op: 'update', table, payload, filters: { ...filters } });
        return Promise.resolve({ data: null, error: null }).then(resolve);
      }
      let out = rows.filter(matches);
      if (order) {
        out = [...out].sort((a, b) => String(a[order!.col]).localeCompare(String(b[order!.col])) * (order!.asc ? 1 : -1));
      }
      captured.push({ op: 'select', table, filters: { ...filters } });
      return Promise.resolve({ data: out.slice(0, limit), error: null }).then(resolve);
    };
    return q;
  },
}));

import {
  recordAttempt, completeAttempt, listAttempts, nextAttemptNumber,
  safeDetail, NON_CALLING_ATTEMPT_OUTCOMES, ATTEMPT_RECORD_VERSION,
} from '../../services/enrichment/attempts';
import { executeEnrichmentRecorded } from '../../services/enrichment/recordedExecution';
import { NON_CALLING_OUTCOMES, ENRICHMENT_OUTCOMES } from '../../services/enrichment/providers/contract';
import type { EnrichmentProviderAdapter, EnrichmentRequest } from '../../services/enrichment/providers/contract';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-06T00:00:00.000Z';
/** Synthetic. Not a credential for anything that exists. */
const SECRET = 'synthetic-tenant-a-provider-key';

const open = (over: Partial<Parameters<typeof recordAttempt>[0]> = {}) => recordAttempt({
  organizationId: ORG_A, subject: 'account', entityId: ACCOUNT,
  providerId: 'clearbit', requestedAttributes: ['employee_count'],
  correlationId: 'corr-1', attemptNumber: 1, startedAt: NOW, ...over,
});

beforeEach(() => { rows.length = 0; captured.length = 0; failNextInsert = false; });

// ───────────────────────────────────────────────────────────────────────────
describe('A4A — tenant isolation', () => {
  it('a tenant reads its own attempt', async () => {
    await open();
    const found = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(found).toHaveLength(1);
    expect(found[0].organizationId).toBe(ORG_A);
  });

  it('tenant B cannot read tenant A’s attempt — the tenant is the predicate', async () => {
    await open();
    const found = await listAttempts({ organizationId: ORG_B, subject: 'account', entityId: ACCOUNT });
    expect(found).toEqual([]);
  });

  it('a write always carries its own tenant — there is no ambient org', async () => {
    await open({ organizationId: ORG_B });
    const w = captured.find((c) => c.op === 'insert')!;
    expect((w.payload as { organization_id: string }).organization_id).toBe(ORG_B);
  });

  it('tenant B cannot close tenant A’s attempt', async () => {
    const { attemptId } = await open();
    await completeAttempt({
      organizationId: ORG_B, attemptId, outcome: 'enriched',
      providerCalled: true, completedAt: NOW,
    });
    // the update matched no row: A's attempt is still open
    const [a] = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(a.outcome).toBeNull();
    expect(a.completedAt).toBeNull();
  });

  it('refuses a tenant-less or entity-less write rather than guessing', async () => {
    await expect(open({ organizationId: '' })).rejects.toThrow(/tenant-less/);
    await expect(open({ entityId: '  ' })).rejects.toThrow(/entityId is required/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A4A — the canonical outcome vocabulary is reused, not duplicated', () => {
  it.each([
    'enriched', 'no_match', 'field_not_found', 'provider_declined', 'provider_unavailable',
    'credential_missing', 'not_implemented', 'quota_exceeded', 'cost_denied',
    'rate_limited', 'timeout', 'malformed_response', 'duplicate_suppressed',
  ] as const)('records %s exactly as the executor reported it', async (outcome) => {
    const { attemptId } = await open();
    await completeAttempt({
      organizationId: ORG_A, attemptId, outcome,
      providerCalled: !NON_CALLING_ATTEMPT_OUTCOMES.includes(outcome), completedAt: NOW,
    });
    const [a] = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(a.outcome).toBe(outcome);
  });

  it('every recorded outcome is a member of the frozen A3 taxonomy', () => {
    for (const o of NON_CALLING_ATTEMPT_OUTCOMES) {
      expect(ENRICHMENT_OUTCOMES as readonly string[]).toContain(o);
    }
  });

  it('the non-calling list is a superset of A3’s, and says why', () => {
    // A3's NON_CALLING_OUTCOMES omits provider_declined because the executor
    // can also emit it AFTER a call. This module additionally treats the
    // pre-egress refusal as non-calling, and `providerCalled` from the executor
    // remains the authority — asserted in the seam tests below.
    for (const o of NON_CALLING_OUTCOMES) {
      expect(NON_CALLING_ATTEMPT_OUTCOMES).toContain(o);
    }
  });

  it('duplicate_suppressed is a real attempt that contacted nobody', async () => {
    const { attemptId } = await open();
    await completeAttempt({
      organizationId: ORG_A, attemptId, outcome: 'duplicate_suppressed',
      providerCalled: false, completedAt: NOW,
    });
    const [a] = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(a.outcome).toBe('duplicate_suppressed');
    expect(a.providerCalled).toBe(false);
    // and emphatically not success
    expect(a.outcome).not.toBe('enriched');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A4A — history is preserved', () => {
  it('a retry is a NEW row; the failure that caused it survives', async () => {
    const first = await open();
    await completeAttempt({
      organizationId: ORG_A, attemptId: first.attemptId, outcome: 'provider_unavailable',
      providerCalled: true, detail: 'HTTP 500', completedAt: NOW,
    });

    const n = await nextAttemptNumber({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: 'clearbit' });
    expect(n).toBe(2);

    const second = await open({ attemptNumber: n, correlationId: 'corr-2' });
    await completeAttempt({
      organizationId: ORG_A, attemptId: second.attemptId, outcome: 'enriched',
      providerCalled: true, completedAt: NOW,
    });

    const all = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.outcome).sort()).toEqual(['enriched', 'provider_unavailable']);
    expect(all.map((a) => a.attemptNumber).sort()).toEqual([1, 2]);
  });

  it('the first attempt number is 1 and is derived from history, not invented', async () => {
    await expect(nextAttemptNumber({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: 'clearbit',
    })).resolves.toBe(1);
  });

  it('attempt numbering is per provider — one provider’s history does not advance another’s', async () => {
    await open({ providerId: 'clearbit' });
    await expect(nextAttemptNumber({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: 'apollo',
    })).resolves.toBe(1);
  });

  it('rejects a non-positive attempt number', async () => {
    await expect(open({ attemptNumber: 0 })).rejects.toThrow(/>= 1/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A4A — identity uses canonical references only', () => {
  it('an account attempt writes account_id and leaves person_id null', async () => {
    await open({ subject: 'account', entityId: ACCOUNT });
    const p = captured.find((c) => c.op === 'insert')!.payload as Record<string, unknown>;
    expect(p.account_id).toBe(ACCOUNT);
    expect(p.person_id).toBeNull();
  });

  it('a person attempt writes person_id and leaves account_id null', async () => {
    await open({ subject: 'person', entityId: PERSON });
    const p = captured.find((c) => c.op === 'insert')!.payload as Record<string, unknown>;
    expect(p.person_id).toBe(PERSON);
    expect(p.account_id).toBeNull();
  });

  it('exactly one subject is ever written — never both', async () => {
    await open({ subject: 'person', entityId: PERSON });
    await open({ subject: 'account', entityId: ACCOUNT });
    for (const c of captured.filter((x) => x.op === 'insert')) {
      const p = c.payload as Record<string, unknown>;
      expect([p.person_id, p.account_id].filter(Boolean)).toHaveLength(1);
    }
  });

  it('a person and an account attempt are separate records, never merged', async () => {
    await open({ subject: 'person', entityId: PERSON });
    await open({ subject: 'account', entityId: ACCOUNT });
    const persons = await listAttempts({ organizationId: ORG_A, subject: 'person', entityId: PERSON });
    const accounts = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(persons).toHaveLength(1);
    expect(accounts).toHaveLength(1);
    expect(persons[0].id).not.toBe(accounts[0].id);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A4A — no secret can reach the record', () => {
  it('a credential-shaped diagnostic is redacted', () => {
    expect(safeDetail(`failed with api_key=${SECRET}`)).not.toContain(SECRET);
    expect(safeDetail(`Authorization: Bearer ${SECRET}`)).not.toContain(SECRET);
    expect(safeDetail(`x-api-key: ${SECRET}`)).not.toContain(SECRET);
    expect(safeDetail('token=abc123')).toContain('[redacted]');
  });

  it('an ordinary diagnostic survives intact', () => {
    expect(safeDetail('HTTP 500 from provider')).toBe('HTTP 500 from provider');
  });

  it('long details are truncated rather than stored whole', () => {
    expect((safeDetail('x'.repeat(2000)) ?? '').length).toBeLessThanOrEqual(501);
  });

  it('a redacted detail is what actually gets written', async () => {
    const { attemptId } = await open();
    await completeAttempt({
      organizationId: ORG_A, attemptId, outcome: 'provider_declined', providerCalled: true,
      detail: `401 authorization: Bearer ${SECRET}`, completedAt: NOW,
    });
    expect(JSON.stringify(captured)).not.toContain(SECRET);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });

  it('the module never reads a credential or the environment', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'backend/services/enrichment/attempts.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toContain('process.env');
    expect(src).not.toContain('resolveCredential');
    expect(src).not.toContain('decryptCredential');
  });

  it('no raw provider payload is stored — evidence is referenced', async () => {
    const { attemptId } = await open();
    await completeAttempt({
      organizationId: ORG_A, attemptId, outcome: 'enriched', providerCalled: true,
      sourceRecordId: 'src-1', attributesReturned: ['employee_count'], completedAt: NOW,
    });
    const p = captured.find((c) => c.op === 'update')!.payload as Record<string, unknown>;
    expect(p.source_record_id).toBe('src-1');
    expect(Object.keys(p)).not.toContain('raw_payload');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A4A — correlation is reused, not reinvented', () => {
  it('the executor’s correlationId is preserved on the attempt', async () => {
    await open({ correlationId: 'run-abc' });
    const [a] = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(a.correlationId).toBe('run-abc');
  });

  it('a blank correlationId is refused', async () => {
    await expect(open({ correlationId: '' })).rejects.toThrow(/correlationId is required/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A4A — the recording seam changes no A3 semantic', () => {
  const request: EnrichmentRequest = {
    organizationId: ORG_A, subject: 'account', entityId: ACCOUNT,
    attributes: ['employee_count'], selectors: { domain: 'example.com' },
    purpose: 'icp', correlationId: 'corr-seam',
  };

  const ports = (over: Partial<ExecuteEnrichmentPorts> = {}): ExecuteEnrichmentPorts => ({
    authorizeCost: over.authorizeCost ?? (async () => ({ authorized: true, holdId: null, cost: { kind: 'unknown' } })),
    releaseCost: async () => { /* noop */ },
    resolveCredential: over.resolveCredential ?? (async () => SECRET),
    findRecentObservation: over.findRecentObservation ?? (async () => null),
    persistObservation: async () => ({ sourceRecordId: 'src-9', canonicalWithheld: [] }),
    now: () => NOW,
  });

  const adapter = (calls: unknown[]): EnrichmentProviderAdapter => ({
    id: 'clearbit', label: 'Clearbit', supports: ['employee_count'], credentialEnvVar: null,
    isAvailable: () => false,
    enrich: async (r) => {
      calls.push(r);
      return {
        outcome: 'enriched', notReturned: [],
        fields: [{ attribute: 'employee_count', subject: 'account', value: 240, observedAt: null, confidence: null, providerInferred: false }],
      };
    },
  });

  it('a successful execution is recorded, with the evidence referenced', async () => {
    const calls: unknown[] = [];
    const out = await executeEnrichmentRecorded(request, 'clearbit', ports(), {
      adapter: adapter(calls), recorder: { now: () => NOW },
    });

    expect(out.result.outcome).toBe('enriched');
    expect(out.attemptNumber).toBe(1);
    const [a] = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(a.outcome).toBe('enriched');
    expect(a.providerCalled).toBe(true);
    expect(a.sourceRecordId).toBe('src-9');
    expect(a.completedAt).toBe(NOW);
  });

  it('credential_missing is recorded and the provider is never contacted', async () => {
    const calls: unknown[] = [];
    const out = await executeEnrichmentRecorded(request, 'clearbit', ports({ resolveCredential: async () => null }), { adapter: adapter(calls) });

    expect(out.result.outcome).toBe('credential_missing');
    expect(calls).toHaveLength(0);
    const [a] = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(a.outcome).toBe('credential_missing');
    expect(a.providerCalled).toBe(false);
  });

  it('cost_denied is recorded as an attempt that made no paid call', async () => {
    const calls: unknown[] = [];
    await executeEnrichmentRecorded(request, 'clearbit',
      ports({ authorizeCost: async () => ({ authorized: false, reason: 'platform limit' }) }),
      { adapter: adapter(calls) });

    expect(calls).toHaveLength(0);
    const [a] = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(a.outcome).toBe('cost_denied');
    expect(a.providerCalled).toBe(false);
  });

  it('duplicate_suppressed is recorded without a provider call', async () => {
    const calls: unknown[] = [];
    await executeEnrichmentRecorded(request, 'clearbit',
      ports({ findRecentObservation: async () => ({ observedAt: NOW }) }),
      { adapter: adapter(calls) });

    expect(calls).toHaveLength(0);
    const [a] = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(a.outcome).toBe('duplicate_suppressed');
    expect(a.providerCalled).toBe(false);
  });

  it('providerCalled comes from the EXECUTOR, never from an outcome mapping here', async () => {
    const calls: unknown[] = [];
    const out = await executeEnrichmentRecorded(request, 'clearbit', ports(), { adapter: adapter(calls) });
    const [a] = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(a.providerCalled).toBe(out.result.providerCalled);
  });

  it('a recording failure does NOT prevent the enrichment the tenant asked for', async () => {
    failNextInsert = true;
    const calls: unknown[] = [];
    const out = await executeEnrichmentRecorded(request, 'clearbit', ports(), { adapter: adapter(calls) });

    expect(out.result.outcome).toBe('enriched');   // work still happened
    expect(out.attemptId).toBeNull();              // and the gap is visible
  });

  it('the seam has no automatic production caller — A4A connects no trigger', () => {
    const { execSync } = require('child_process');
    const hits = execSync(
      'git grep -l "executeEnrichmentRecorded" -- "backend" "pages" || true',
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean).filter((f: string) => !f.includes('/tests/') && !f.includes('recordedExecution.ts'));
    expect(hits).toEqual([]);
  });

  it('the record version is stated, so a row traces to its writer', () => {
    expect(ATTEMPT_RECORD_VERSION).toBe('a4a.1');
  });
});
