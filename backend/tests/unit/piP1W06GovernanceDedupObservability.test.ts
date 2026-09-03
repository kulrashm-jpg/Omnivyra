/**
 * PI-P1-W06 — governance and dedup observability.
 *
 * W06 is OBSERVABILITY ONLY. These tests pin the two things that makes true:
 * that the evidence now exists, and that producing it can never change the
 * safety decision it observes.
 *
 * The defect W06 closes: `isSuppressed` answered `{ suppressed: true }` both
 * when the rules said no and when the governance table could not be read, and
 * recorded neither. A governance outage was indistinguishable from a quiet,
 * well-behaved system. The outreach module already drew that distinction
 * (`recordGovernanceFailure`); Path B did not.
 */

type Row = Record<string, unknown>;
type Counter = { name: string; labels: Record<string, string> };
type Log = { level: 'info' | 'warn'; event: string; payload: Record<string, unknown> };

const counters: Counter[] = [];
const logs: Log[] = [];
let counterThrows = false;
let loggerThrows = false;

jest.mock('../../observability/metrics', () => ({
  recordRawCounter: (name: string, _v: number, labels: Record<string, string>) => {
    if (counterThrows) throw new Error('metrics backend is down');
    counters.push({ name, labels });
  },
  recordRawHistogram: () => undefined,
}));

jest.mock('../../services/logger', () => ({
  logger: {
    debug: () => undefined,
    info: (event: string, payload: Record<string, unknown>) => {
      if (loggerThrows) throw new Error('log transport is down');
      logs.push({ level: 'info', event, payload });
    },
    warn: (event: string, payload: Record<string, unknown>) => {
      if (loggerThrows) throw new Error('log transport is down');
      logs.push({ level: 'warn', event, payload });
    },
    error: () => undefined,
  },
}));

// ── DB double ───────────────────────────────────────────────────────────────
const db = {
  rows: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code: string; message: string } | undefined>,
  insertError: {} as Record<string, { code: string; message: string } | undefined>,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let op: 'select' | 'insert' = 'select';

    const matches = (r: Row): boolean =>
      filters.every(([kind, col, val]) => {
        if (kind === 'eq') return r[col] === val;
        if (kind === 'contains') {
          const sub = val as Record<string, unknown>;
          const actual = (r[col] ?? {}) as Record<string, unknown>;
          return Object.entries(sub).every(([k, v]) => JSON.stringify(actual[k]) === JSON.stringify(v));
        }
        return true;
      });

    const result = async (): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      if (op === 'insert') {
        const err = db.insertError[table];
        return err ? { data: null, error: err } : { data: { id: `${table}-1` }, error: null };
      }
      const fail = db.failures[table];
      if (fail) return { data: null, error: fail };
      return { data: (db.rows[table] ?? []).filter(matches), error: null };
    };

    const api: Record<string, unknown> = {
      select: () => api,
      insert: () => { op = 'insert'; return api; },
      update: () => { op = 'insert'; return api; },
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return api; },
      is: (c: string, v: unknown) => { filters.push(['eq', c, v]); return api; },
      in: () => api,
      gte: () => api,
      limit: () => api,
      contains: (c: string, v: unknown) => { filters.push(['contains', c, v]); return api; },
      single: () => result(),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    return api;
  },
}));

jest.mock('../../services/prospectIdentity/contactGovernanceRepository', () => ({
  loadGovernanceRecords: jest.fn(),
  normalizeGovernanceTarget: (_c: string, t: string) => String(t ?? '').trim().toLowerCase(),
}));

import { isSuppressed } from '../../services/execution/suppressionService';
import { detectAndParkDuplicates } from '../../services/prospectIdentity/personDuplicates';
import { resolveOrCreateAccount } from '../../services/prospectIdentity/accountResolution';
import { loadGovernanceRecords } from '../../services/prospectIdentity/contactGovernanceRepository';
import {
  GOVERNANCE_FAILCLOSED_STAGES,
  DEDUP_OUTCOMES,
  IDENTITY_METRICS,
} from '../../services/prospectIdentity/telemetry';

const mLoad = loadGovernanceRecords as jest.Mock;

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PERSON = 'person-a';
const EMAIL = 'ada@example.com';
const PHONE = '+441234567890';

const named = (n: string) => counters.filter((c) => c.name === n);
const labelsFor = (n: string) => named(n).map((c) => c.labels);
/** Everything that reached a metric label or a log payload. */
const allEmitted = () => JSON.stringify(counters) + JSON.stringify(logs);

beforeEach(() => {
  counters.length = 0;
  logs.length = 0;
  counterThrows = false;
  loggerThrows = false;
  db.rows = {};
  db.failures = {};
  db.insertError = {};
  mLoad.mockReset();
  mLoad.mockResolvedValue({ ok: true, records: [] });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W06 governance — a refusal and an outage are no longer the same event', () => {
  it('an allow-by-absence is counted, so "nobody is suppressed" differs from "we never checked"', async () => {
    const r = await isSuppressed(ORG, 'email', EMAIL);
    expect(r.suppressed).toBe(false);
    expect(labelsFor(IDENTITY_METRICS.governance.decisions)).toEqual([{ decision: 'allowed', store: 'none' }]);
    expect(named(IDENTITY_METRICS.governance.failClosed)).toHaveLength(0);
  });

  it('a REAL canonical suppression counts as a decision and NOT as a failure', async () => {
    mLoad.mockResolvedValue({
      ok: true,
      records: [{
        id: 'gov-1',
        organizationId: ORG,
        personId: null,
        targetNormalized: EMAIL,
        channel: 'email',
        governanceType: 'unsubscribe',
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveUntil: null,
        revokedAt: null,
      }],
    });

    const r = await isSuppressed(ORG, 'email', EMAIL);
    expect(r.suppressed).toBe(true);
    expect(labelsFor(IDENTITY_METRICS.governance.decisions)).toEqual([{ decision: 'suppressed', store: 'canonical' }]);
    // The compliance signal must never be inflated by outage counts.
    expect(named(IDENTITY_METRICS.governance.failClosed)).toHaveLength(0);
  });

  it('an unreadable canonical table records a FAIL-CLOSED stage as well as the suppression', async () => {
    mLoad.mockRejectedValue(new Error('connection reset'));

    const r = await isSuppressed(ORG, 'email', EMAIL);
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe('governance_lookup_failed_failclosed');
    expect(labelsFor(IDENTITY_METRICS.governance.failClosed)).toEqual([{ stage: 'canonical_read' }]);
    // Recorded IN ADDITION to, never INSTEAD OF, the refusal: the person was
    // still not contacted, and that is still a refusal.
    expect(labelsFor(IDENTITY_METRICS.governance.decisions)).toEqual([{ decision: 'suppressed', store: 'canonical' }]);
  });

  it('a missing tenant records its own distinct stage', async () => {
    const r = await isSuppressed('', 'email', EMAIL);
    expect(r.suppressed).toBe(true);
    expect(labelsFor(IDENTITY_METRICS.governance.failClosed)).toEqual([{ stage: 'no_tenant' }]);
  });

  it('a legacy read error records legacy_read, distinct from the canonical stage', async () => {
    db.failures.suppression_entries = { code: '08006', message: 'connection failure' };

    const r = await isSuppressed(ORG, 'email', EMAIL);
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe('suppression_lookup_error_failclosed');
    expect(labelsFor(IDENTITY_METRICS.governance.failClosed)).toEqual([{ stage: 'legacy_read' }]);
  });

  it('the four fail-closed stages are all distinct — one "error" label would not locate the fault', () => {
    expect(new Set(GOVERNANCE_FAILCLOSED_STAGES).size).toBe(4);
    expect([...GOVERNANCE_FAILCLOSED_STAGES]).toEqual(
      ['no_tenant', 'canonical_read', 'legacy_read', 'legacy_exception'],
    );
  });

  it('a fail-closed suppression is logged at WARN with the tenant and the stage', async () => {
    mLoad.mockRejectedValue(new Error('down'));
    await isSuppressed(ORG, 'email', EMAIL);
    const warns = logs.filter((l) => l.event === 'contact_governance_failclosed');
    expect(warns).toHaveLength(1);
    expect(warns[0].level).toBe('warn');
    expect(warns[0].payload.stage).toBe('canonical_read');
    expect(warns[0].payload.companyId).toBe(ORG);
  });

  it('a REAL suppression emits no fault log — an outage alert must not fire on compliance', async () => {
    mLoad.mockResolvedValue({
      ok: true,
      records: [{
        id: 'gov-1',
        organizationId: ORG,
        personId: null,
        targetNormalized: EMAIL,
        channel: 'email',
        governanceType: 'unsubscribe',
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveUntil: null,
        revokedAt: null,
      }],
    });
    await isSuppressed(ORG, 'email', EMAIL);
    expect(logs.filter((l) => l.event === 'contact_governance_failclosed')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W06 — observation NEVER gates the safety decision', () => {
  it('a metrics backend that throws does not turn a fail-closed suppression into an allow', async () => {
    counterThrows = true;
    mLoad.mockRejectedValue(new Error('down'));

    const r = await isSuppressed(ORG, 'email', EMAIL);
    expect(r).toEqual({ suppressed: true, reason: 'governance_lookup_failed_failclosed', store: 'canonical' });
  });

  it('a log transport that throws does not change the verdict either', async () => {
    loggerThrows = true;
    mLoad.mockRejectedValue(new Error('down'));

    const r = await isSuppressed(ORG, 'email', EMAIL);
    expect(r.suppressed).toBe(true);
  });

  it('a throwing metrics backend does not break a legitimate ALLOW', async () => {
    counterThrows = true;
    const r = await isSuppressed(ORG, 'email', EMAIL);
    expect(r.suppressed).toBe(false);
  });

  it('a throwing metrics backend does not break duplicate detection or its result', async () => {
    counterThrows = true;
    loggerThrows = true;
    db.rows.unified_persons = [
      { id: PERSON, company_id: ORG, primary_email: EMAIL, status: 'active' },
      { id: 'person-b', company_id: ORG, primary_email: EMAIL, status: 'active' },
    ];

    const r = await detectAndParkDuplicates({ organizationId: ORG, personId: PERSON, email: EMAIL });
    expect(r.detected).toHaveLength(1);
    expect(r.parked).toBe(1);
  });

  it('a throwing metrics backend does not change an AMBIGUOUS account refusal', async () => {
    counterThrows = true;
    loggerThrows = true;
    db.rows.prospect_accounts = [
      { id: 'acct-1', organization_id: ORG, source: 'crm', source_reference: 'X1', domain_normalized: 'a.test', status: 'active' },
      { id: 'acct-2', organization_id: ORG, source: 'crm', source_reference: 'other', domain_normalized: 'acme.test', status: 'active' },
    ];

    const r = await resolveOrCreateAccount(ORG, { source: 'crm', sourceReference: 'X1', domain: 'acme.test' });
    expect(r.outcome).toBe('ambiguous');
    expect(r.accountId).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W06 dedup — the clean pass is now distinguishable from no pass at all', () => {
  it('a pass that found nothing records `none` — it previously left no trace anywhere', async () => {
    db.rows.unified_persons = [{ id: PERSON, company_id: ORG, primary_email: EMAIL, status: 'active' }];

    const r = await detectAndParkDuplicates({ organizationId: ORG, personId: PERSON, email: EMAIL });
    expect(r.detected).toHaveLength(0);
    expect(labelsFor(IDENTITY_METRICS.dedup.detection)).toEqual([{ outcome: 'none' }]);
  });

  it('a parked candidate is recorded per CANDIDATE, not per pass', async () => {
    db.rows.unified_persons = [
      { id: PERSON, company_id: ORG, primary_email: EMAIL, primary_phone: PHONE, status: 'active' },
      { id: 'person-b', company_id: ORG, primary_email: EMAIL, status: 'active' },
      { id: 'person-c', company_id: ORG, primary_phone: PHONE, status: 'active' },
    ];

    const r = await detectAndParkDuplicates({ organizationId: ORG, personId: PERSON, email: EMAIL, phone: PHONE });
    expect(r.detected).toHaveLength(2);
    expect(labelsFor(IDENTITY_METRICS.dedup.detection)).toEqual([{ outcome: 'parked' }, { outcome: 'parked' }]);
  });

  it('an already-open candidate is recorded distinctly from a newly parked one', async () => {
    db.insertError.person_duplicate_candidates = { code: '23505', message: 'duplicate key' };
    db.rows.unified_persons = [
      { id: PERSON, company_id: ORG, primary_email: EMAIL, status: 'active' },
      { id: 'person-b', company_id: ORG, primary_email: EMAIL, status: 'active' },
    ];

    const r = await detectAndParkDuplicates({ organizationId: ORG, personId: PERSON, email: EMAIL });
    expect(r.alreadyOpen).toBe(1);
    expect(labelsFor(IDENTITY_METRICS.dedup.detection)).toEqual([{ outcome: 'already_open' }]);
  });

  it('the outcome vocabulary is a closed set of three', () => {
    expect([...DEDUP_OUTCOMES]).toEqual(['none', 'parked', 'already_open']);
  });

  it('the log line carries ids and the deterministic signal, and no contact value', async () => {
    db.rows.unified_persons = [
      { id: PERSON, company_id: ORG, primary_email: EMAIL, status: 'active' },
      { id: 'person-b', company_id: ORG, primary_email: EMAIL, status: 'active' },
    ];

    await detectAndParkDuplicates({ organizationId: ORG, personId: PERSON, email: EMAIL });
    const line = logs.find((l) => l.event === 'person_duplicates_parked');
    expect(line).toBeDefined();
    expect(line?.payload.personId).toBe(PERSON);
    expect(line?.payload.classifications).toEqual(['definite']);
    expect(line?.payload.matchedOn).toEqual(['email']);
  });

  it('a clean pass emits NO log line — only the counter, so the log stays signal', async () => {
    db.rows.unified_persons = [{ id: PERSON, company_id: ORG, primary_email: EMAIL, status: 'active' }];
    await detectAndParkDuplicates({ organizationId: ORG, personId: PERSON, email: EMAIL });
    expect(logs.filter((l) => l.event === 'person_duplicates_parked')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W06 account identity — a refused merge is no longer an invisible non-event', () => {
  const twoAccounts = () => {
    db.rows.prospect_accounts = [
      { id: 'acct-1', organization_id: ORG, source: 'crm', source_reference: 'X1', domain_normalized: 'a.test', status: 'active' },
      { id: 'acct-2', organization_id: ORG, source: 'crm', source_reference: 'other', domain_normalized: 'acme.test', status: 'active' },
    ];
  };

  it('AMBIGUOUS is recorded, where the orchestrator would collapse it to a bare null', async () => {
    twoAccounts();
    const r = await resolveOrCreateAccount(ORG, { source: 'crm', sourceReference: 'X1', domain: 'acme.test' });
    expect(r.outcome).toBe('ambiguous');
    expect(labelsFor(IDENTITY_METRICS.account.resolution)).toEqual([{ outcome: 'ambiguous' }]);
  });

  it('an ambiguous refusal is logged at WARN with the candidate ids a human needs', async () => {
    twoAccounts();
    await resolveOrCreateAccount(ORG, { source: 'crm', sourceReference: 'X1', domain: 'acme.test' });
    const warn = logs.find((l) => l.event === 'prospect_account_ambiguous');
    expect(warn?.level).toBe('warn');
    expect(warn?.payload.companyId).toBe(ORG);
    expect(warn?.payload.candidateCount).toBe(2);
    expect(warn?.payload.candidateAccountIds).toEqual(expect.arrayContaining(['acct-1', 'acct-2']));
  });

  it('a match and a creation are recorded with their own outcomes', async () => {
    db.rows.prospect_accounts = [
      { id: 'acct-1', organization_id: ORG, source: 'crm', source_reference: 'X1', domain_normalized: 'acme.test', status: 'active' },
    ];
    await resolveOrCreateAccount(ORG, { domain: 'acme.test' });
    expect(labelsFor(IDENTITY_METRICS.account.resolution)).toEqual([{ outcome: 'matched_domain' }]);

    counters.length = 0;
    db.rows.prospect_accounts = [];
    await resolveOrCreateAccount(ORG, { domain: 'new.test' });
    expect(labelsFor(IDENTITY_METRICS.account.resolution)).toEqual([{ outcome: 'created' }]);
  });

  it('insufficient evidence — a name alone — is recorded rather than silently dropped', async () => {
    const r = await resolveOrCreateAccount(ORG, { name: 'Acme Holdings Ltd' });
    expect(r.outcome).toBe('insufficient_evidence');
    expect(labelsFor(IDENTITY_METRICS.account.resolution)).toEqual([{ outcome: 'insufficient_evidence' }]);
  });

  it('a non-ambiguous outcome emits no WARN — the alert means a human decision is owed', async () => {
    db.rows.prospect_accounts = [];
    await resolveOrCreateAccount(ORG, { domain: 'new.test' });
    expect(logs.filter((l) => l.event === 'prospect_account_ambiguous')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W06 — bounded cardinality and no sensitive data', () => {
  it('NO metric label carries a tenant, person or account id', async () => {
    db.rows.prospect_accounts = [
      { id: 'acct-1', organization_id: ORG, source: 'crm', source_reference: 'X1', domain_normalized: 'a.test', status: 'active' },
      { id: 'acct-2', organization_id: ORG, source: 'crm', source_reference: 'other', domain_normalized: 'acme.test', status: 'active' },
    ];
    db.rows.unified_persons = [
      { id: PERSON, company_id: ORG, primary_email: EMAIL, status: 'active' },
      { id: 'person-b', company_id: ORG, primary_email: EMAIL, status: 'active' },
    ];
    await isSuppressed(ORG, 'email', EMAIL);
    await detectAndParkDuplicates({ organizationId: ORG, personId: PERSON, email: EMAIL });
    await resolveOrCreateAccount(ORG, { source: 'crm', sourceReference: 'X1', domain: 'acme.test' });

    expect(counters.length).toBeGreaterThan(0);
    const emitted = JSON.stringify(counters);
    for (const unbounded of [ORG, OTHER, PERSON, 'person-b', 'acct-1', 'acct-2']) {
      expect(emitted).not.toContain(unbounded);
    }
  });

  it('the CONTACT VALUE never reaches a metric or a log — it is what suppression protects', async () => {
    mLoad.mockRejectedValue(new Error('down'));
    await isSuppressed(ORG, 'email', EMAIL);

    db.rows.unified_persons = [
      { id: PERSON, company_id: ORG, primary_email: EMAIL, primary_phone: PHONE, status: 'active' },
      { id: 'person-b', company_id: ORG, primary_email: EMAIL, status: 'active' },
    ];
    await detectAndParkDuplicates({ organizationId: ORG, personId: PERSON, email: EMAIL, phone: PHONE });

    expect(allEmitted()).not.toContain(EMAIL);
    expect(allEmitted()).not.toContain(PHONE);
    expect(allEmitted()).not.toContain('ada');
  });

  it('the prospect company name, domain and website never reach a metric or a log', async () => {
    db.rows.prospect_accounts = [
      { id: 'acct-1', organization_id: ORG, source: 'crm', source_reference: 'X1', domain_normalized: 'a.test', status: 'active' },
      { id: 'acct-2', organization_id: ORG, source: 'crm', source_reference: 'other', domain_normalized: 'acme.test', status: 'active' },
    ];
    await resolveOrCreateAccount(ORG, {
      source: 'crm',
      sourceReference: 'X1',
      domain: 'acme.test',
      name: 'Acme Holdings Ltd',
      websiteUrl: 'https://acme.test',
    });

    expect(allEmitted()).not.toContain('Acme Holdings');
    expect(allEmitted()).not.toContain('acme.test');
  });

  it('every metric name is declared in the module and follows the HARDEN-001 convention', async () => {
    const declared: string[] = [
      IDENTITY_METRICS.governance.decisions,
      IDENTITY_METRICS.governance.failClosed,
      IDENTITY_METRICS.dedup.detection,
      IDENTITY_METRICS.account.resolution,
    ];
    for (const n of declared) expect(n).toMatch(/^identity\.[a-z_]+\.[a-z_]+$/);

    await isSuppressed(ORG, 'email', EMAIL);
    for (const c of counters) expect(declared).toContain(c.name);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W06 — no second governance or dedup system was created', () => {
  it('the telemetry module writes NO database table and holds no rule', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectIdentity/telemetry.ts'), 'utf8');
    expect(src).not.toContain('ownedDbTable');
    expect(src).not.toContain('supabase');
    // It must not restate any governance or duplicate rule.
    expect(src).not.toContain('GOVERNANCE_TYPES');
    expect(src).not.toContain('CLASSIFICATION_BY_SIGNAL');
  });

  it('mayContact stays PURE — the evaluator observes nothing itself', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectIdentity/contactGovernance.ts'), 'utf8');
    expect(src).not.toContain('./telemetry');
    expect(src).not.toContain('logger');
  });
});
