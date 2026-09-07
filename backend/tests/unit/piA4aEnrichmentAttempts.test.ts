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

    // A4Y — `requested_attributes` is a text[] column filtered through a
    // PostgreSQL array literal, so it is compared as one rather than by the
    // reference equality the scalar filters use.
    const arrayFilters: Record<string, string> = {};
    const literal = (v: unknown): string =>
      (Array.isArray(v) && v.length
        ? `{${v.map((e) => `"${String(e).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`
        : '{}');

    const matches = (r: Record<string, unknown>) =>
      Object.entries(filters).every(([k, v]) => r[k] === v)
      && Object.entries(arrayFilters).every(([k, v]) => literal(r[k]) === v);

    const q: Record<string, unknown> = {};
    q.filter = (col: string, _op: string, val: string) => { arrayFilters[col] = val; return q; };
    q.insert = (p: Record<string, unknown>) => { mode = 'insert'; payload = p; return q; };
    q.update = (p: Record<string, unknown>) => { mode = 'update'; payload = p; return q; };
    q.select = () => q;
    q.eq = (col: string, val: unknown) => { filters[col] = val; return q; };
    // A4V — `markProviderCallPending` narrows with `.is('completed_at', null)`.
    // The mock lacked it, so the real marker threw; before A4V the manual path
    // swallowed that, and these tests passed only because of the defect.
    q.is = (col: string, val: unknown) => { filters[col] = val; return q; };
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
      providerCalled: true, executionStatus: 'completed', completedAt: NOW,
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
      providerCalled: !NON_CALLING_ATTEMPT_OUTCOMES.includes(outcome),
      // A5: a non-calling outcome is a refusal WE made before transport.
      executionStatus: NON_CALLING_ATTEMPT_OUTCOMES.includes(outcome) ? 'refused_pre_call' : 'completed',
      completedAt: NOW,
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
      providerCalled: false, executionStatus: 'refused_pre_call', completedAt: NOW,
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
      providerCalled: true, executionStatus: 'completed', detail: 'HTTP 500', completedAt: NOW,
    });

    // A4Y — numbering is per WORK ITEM, so the set `open()` used must be named.
    const n = await nextAttemptNumber({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT,
      providerId: 'clearbit', requestedAttributes: ['employee_count'],
    });
    expect(n).toBe(2);

    const second = await open({ attemptNumber: n, correlationId: 'corr-2' });
    await completeAttempt({
      organizationId: ORG_A, attemptId: second.attemptId, outcome: 'enriched',
      providerCalled: true, executionStatus: 'completed', completedAt: NOW,
    });

    const all = await listAttempts({ organizationId: ORG_A, subject: 'account', entityId: ACCOUNT });
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.outcome).sort()).toEqual(['enriched', 'provider_unavailable']);
    expect(all.map((a) => a.attemptNumber).sort()).toEqual([1, 2]);
  });

  it('the first attempt number is 1 and is derived from history, not invented', async () => {
    await expect(nextAttemptNumber({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT,
      providerId: 'clearbit', requestedAttributes: ['employee_count'],
    })).resolves.toBe(1);
  });

  it('attempt numbering is per provider — one provider’s history does not advance another’s', async () => {
    await open({ providerId: 'clearbit' });
    await expect(nextAttemptNumber({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT,
      providerId: 'apollo', requestedAttributes: ['employee_count'],
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
      executionStatus: 'completed',
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
      executionStatus: 'completed',
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

  /**
   * The executable half of a source file: comments and literals removed.
   *
   * A4C's guard used to ask `git grep -l <symbol>`, which is a TEXT match over
   * whole files. That was sound only while no module discussed the chain in
   * prose. A7's retry consumer explains in a doc comment which branch of
   * `executeEnrichmentRecorded` a lease takes — and was thereby counted as a
   * caller of a function it never calls, and cannot: its only runtime imports
   * are two predicates, everything else is `import type`.
   *
   * So mentions are stripped before anything is asked about calls. A symbol that
   * survives here is one the compiler would emit.
   */
  const executableSource = (code: string): string => code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')            // block comments, JSDoc included
    .replace(/(^|[^:])\/\/.*$/gm, '$1')           // line comments, but not `://`
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')          // template literals
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")          // single-quoted strings
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');         // double-quoted strings

  /**
   * Does this source USE `symbol` in a way that can execute it?
   *
   * An earlier version asked for the name followed by an open parenthesis. That
   * was too narrow, and `consumeEnrichmentWork` is the proof: it writes
   * `const execute = deps?.execute ?? executeEnrichmentRecorded` and then calls
   * `execute(...)`. The seam is genuinely invoked, through an alias, and a
   * `symbol(` rule reports no caller at all — the most dangerous direction for
   * a guard to be wrong in.
   *
   * So the question is inverted: what is left after removing everything that
   * CANNOT execute?
   *
   *   comments and JSDoc      prose about the chain
   *   strings and templates   names in messages and documentation
   *   import / export-from    a type-only import, and a value import which by
   *                           itself invokes nothing
   *   the declaration itself  a module is not its own caller
   *
   * If the identifier still appears after all of that, the module holds a live
   * reference to it and can call it — directly or through an alias. That is the
   * property the invariant is about.
   */
  const isExecutableCaller = (code: string, symbol: string): boolean => {
    const body = executableSource(code)
      // import/export statements, including multi-line named lists
      .replace(/^\s*(?:import|export)\s[\s\S]*?from\s*(?:''|"")\s*;?\s*$/gm, ' ')
      .replace(/^\s*import\s+(?:''|"")\s*;?\s*$/gm, ' ')
      .replace(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${symbol}\\s*\\(`, 'g'), ' ')
      .replace(new RegExp(`(?:export\\s+)?(?:const|let)\\s+${symbol}\\s*=`, 'g'), ' ');
    return new RegExp(`\\b${symbol}\\b`).test(body);
  };

  /** Production files that actually call `symbol`. Sorted, tests excluded. */
  const callers = (symbol: string): string[] => {
    const { execSync } = require('child_process');
    const fs = require('fs');
    return execSync(`git grep -l "${symbol}" -- "backend" "pages" || true`, { encoding: 'utf8' })
      .split('\n').filter(Boolean)
      .filter((f: string) => !f.includes('/tests/'))
      .filter((f: string) => isExecutableCaller(fs.readFileSync(f, 'utf8'), symbol))
      .sort();
  };

  it('a mention is not a call — comments, docs, strings and type imports do not count', () => {
    // The precision the topology assertion depends on, held on its own so a
    // regression in the detector is distinguishable from a regression in the
    // architecture. Each snippet below is a way a symbol can appear in a file
    // that does not execute it.
    const mentions = [
      '// executeEnrichmentRecorded is used here',
      '/** Calls executeEnrichmentRecorded(request, id) internally. */',
      "const doc = 'executeEnrichmentRecorded(request)';",
      'const msg = `executeEnrichmentRecorded(${x})`;',
      "import type { executeEnrichmentRecorded } from './recordedExecution';",
      "import { executeEnrichmentRecorded } from './recordedExecution';",
    ];
    for (const snippet of mentions) {
      expect(isExecutableCaller(snippet, 'executeEnrichmentRecorded')).toBe(false);
    }

    // And the things that ARE calls still are.
    for (const snippet of [
      'const out = await executeEnrichmentRecorded(request, providerId, ports, {});',
      'return executeEnrichmentRecorded(r, p, ports);',
      'execute: (i) => executeEnrichmentRecorded(i),',
    ]) {
      expect(isExecutableCaller(snippet, 'executeEnrichmentRecorded')).toBe(true);
    }

    // A module that declares the function is not its own caller...
    expect(isExecutableCaller(
      'export async function executeEnrichmentRecorded(request, id) { return 1; }',
      'executeEnrichmentRecorded')).toBe(false);
    // ...but a module that declares it AND calls it elsewhere still is.
    expect(isExecutableCaller(
      'export async function executeEnrichmentRecorded(r) { return 1; }\n'
      + 'export const again = (r) => executeEnrichmentRecorded(r);',
      'executeEnrichmentRecorded')).toBe(true);

    // The live proof of the false positive this detector was written for: the
    // retry consumer names the seam in prose and does not call it.
    const fs = require('fs');
    const path = require('path');
    const consumer = fs.readFileSync(
      path.join(__dirname, '../../services/enrichment/retryConsumer.ts'), 'utf8');
    // The selector names both seams in prose — it explains what it gave up to
    // them — and holds a live reference to neither.
    expect(consumer).toContain('executePlannedField');                            // mentioned
    expect(isExecutableCaller(consumer, 'executePlannedField')).toBe(false);      // not used
    expect(consumer).toContain('decideEnrichmentAction');                         // mentioned
    expect(isExecutableCaller(consumer, 'decideEnrichmentAction')).toBe(false);   // not used
  });

  it('every automatic caller of the enrichment chain is a SANCTIONED one', () => {
    // ─── WHAT THIS INVARIANT IS NOW ────────────────────────────────────────
    // A4C's rule was "nothing calls the chain automatically", and it held while
    // no scheduler existed. A7 built one deliberately, so the rule is inverted
    // rather than deleted, exactly as A6B inverted A6A's no-index invariant: the
    // chain may be reached automatically ONLY through an entry point named here.
    // A new background job that calls the executor directly is still caught —
    // it appears in one of these lists and is not in the expected value.

    // The provider executor is reached from exactly one place.
    expect(callers('executeEnrichment')).toEqual(
      ['backend/services/enrichment/recordedExecution.ts']);

    // ─── TWO sanctioned callers of the recorded seam, and no third ─────────
    // Each is a decision, not an observation, and each is admitted for a
    // stated reason:
    //
    //   consumeEnrichmentWork.ts  A7E's consumer seam. Held to a STRICTER
    //                             standard than the route is — it takes a
    //                             lease, requires an attempt record, requires
    //                             ports it cannot assemble, and owns no write.
    //   execution.ts              A4B's plan seam, reached only from A6's
    //                             request-scoped boundary (asserted below).
    //
    // Admitting a caller is paired with proving how that caller is reached.
    expect(callers('executeEnrichmentRecorded')).toEqual([
      'backend/services/enrichment/consumeEnrichmentWork.ts',
      'backend/services/enrichment/execution.ts',
    ]);

    // ─── the RECONCILED topology ──────────────────────────────────────────
    // A7J pinned the consumer at ZERO callers, because at that point nothing
    // was allowed to trigger it. A7's scheduler is now that trigger, and it is
    // the ONLY one. The caller is the JOB, not the selector: the job owns the
    // production wiring and hands the seam to the selector as a port, so the
    // selector holds a type import and no live reference. A second entry here —
    // a route, a queue, a worker, another job — fails before it can ever run.
    expect(callers('consumeEnrichmentWork')).toEqual(
      ['backend/jobs/prospectRetryJob.ts']);

    // The plan seam is back to ONE caller. The scheduler used to appear here
    // too, executing through the planner; reconciliation routed it through the
    // consumer seam instead, so the interactive path is once again the only
    // way into `executePlannedField`.
    expect(callers('executePlannedField')).toEqual(
      ['backend/apiHandlers/prospects/prospectIntelligenceRead.ts']);

    // The user path: reached only from a request-scoped POST route.
    expect(callers('executeProspectEnrichment')).toEqual(
      ['pages/api/prospects/[id]/enrich.ts']);

    // The automatic path, link by link: the job only from the existing cron
    // tick, the cycle only from the job, the selector's hand-off only from the
    // cycle. Every step is pinned, so no link can be added silently.
    expect(callers('runProspectRetryJob')).toEqual(['backend/scheduler/cron.ts']);
    expect(callers('runRetryCycle')).toEqual(['backend/jobs/prospectRetryJob.ts']);
    expect(callers('retryOneCandidate')).toEqual(
      ['backend/services/enrichment/retryConsumer.ts']);

    // And the decision layer is reached only from the consumer seam — nothing
    // may classify a work item and act on it somewhere else.
    expect(callers('decideEnrichmentAction')).toEqual(
      ['backend/services/enrichment/consumeEnrichmentWork.ts']);

    // And nothing along the chain schedules ITSELF. An entry point may be
    // CALLED on a timer; it may not contain one. `cron.ts` is deliberately
    // absent from this list — it IS the sanctioned timer.
    const fs = require('fs');
    const path = require('path');
    const chain: Array<[string, string]> = [
      ['../../services/enrichment', 'execution.ts'],
      ['../../services/enrichment', 'recordedExecution.ts'],
      ['../../services/enrichment', 'attempts.ts'],
      ['../../apiHandlers/prospects', 'prospectIntelligenceRead.ts'],
      ['../../../pages/api/prospects/[id]', 'enrich.ts'],
      // A7J — the consumer seam is the module a scheduler would MOST plausibly
      // be written into, being the one shaped like a unit of work. It may be
      // called; it may not start itself.
      ['../../services/enrichment', 'consumeEnrichmentWork.ts'],
      ['../../services/enrichment', 'decideEnrichmentAction.ts'],
      // A7's own two modules are held to the same rule: the selector chooses
      // and hands off, the job runs one tick. Neither starts a timer; the cron
      // tick calls the job, which is why `cron.ts` is absent from this list.
      ['../../services/enrichment', 'retryConsumer.ts'],
      ['../../jobs', 'prospectRetryJob.ts'],
    ];
    for (const [dir, rel] of chain) {
      const code = executableSource(fs.readFileSync(path.join(__dirname, dir, rel), 'utf8'));
      expect(code).not.toMatch(/setInterval|setTimeout|node-cron|cron\.|bullmq|new Queue|new Worker|\.schedule\(/);
    }
  });

  it('the record version is stated, so a row traces to its writer', () => {
    expect(ATTEMPT_RECORD_VERSION).toBe('a4a.1');
  });
});
