/**
 * A3 — governance convergence at the ONE suppression seam.
 *
 * `suppressionService` is the only reader of `suppression_entries` in the
 * codebase, so migrating it migrates `executionBridge` and the
 * lead-intelligence execution route without touching either. These tests pin
 * the four properties that migration must not get wrong:
 *
 *   1. the CANONICAL store is consulted, and it can block on its own
 *   2. the LEGACY store still blocks, because it still holds the one scope
 *      (`__global__`) the canonical model cannot express
 *   3. BOTH reads fail closed — an unreadable do-not-contact list must never
 *      read as "nobody is suppressed"
 *   4. every rule comes from `mayContact`; no second governance engine appears
 */

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code: string; message: string }>,
  queries: [] as Array<{ table: string; op: string; filters: Filter[]; payload: Row | null }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', filters: [] as Filter[], payload: null as Row | null };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row): boolean =>
      st.filters.every(([kind, col, val]) => {
        if (kind === 'eq') return r[col] === val;
        if (kind === 'is') return (r[col] ?? null) === val;
        if (kind === 'in') return Array.isArray(val) && (val as unknown[]).includes(r[col] ?? null);
        return true;
      });

    const exec = async (mode: 'many' | 'maybe'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.queries.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      const failure = db.failures[table];
      if (failure) return { data: null, error: failure };

      if (st.op === 'insert' || st.op === 'upsert') {
        // Emulate the column defaults the real schema applies. The canonical
        // writer deliberately omits `effective_from` and lets
        // `DEFAULT now()` fill it (20261003000000); without that here, a
        // freshly written record would read back with no start instant and
        // `mayContact` would correctly judge it not yet in force — a defect of
        // the double, not of the code under test.
        const defaults: Row = table === 'contact_governance_records'
          ? { effective_from: new Date().toISOString(), effective_until: null, revoked_at: null, person_id: null, target_normalized: null }
          : {};
        const created = { id: `${table}-${db.nextId++}`, ...defaults, ...(st.payload as Row) };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        const hit = rows().filter(match);
        for (const r of hit) Object.assign(r, st.payload);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      const found = rows().filter(match);
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      upsert: (p: Row) => { st.op = 'upsert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push(['is', c, v]); return b; },
      in: (c: string, v: unknown) => { st.filters.push(['in', c, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      maybeSingle: () => exec('maybe'),
      single: () => exec('maybe'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import {
  addSuppression,
  isSuppressed,
  releaseSuppression,
  toGovernanceType,
} from '../../services/execution/suppressionService';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const TARGET = 'CTO@Example.Test';
const NORMALISED = 'cto@example.test';

const govRow = (over: Row = {}): Row => ({
  id: 'g1', organization_id: ORG_A, person_id: null, target_normalized: NORMALISED,
  channel: '*', governance_type: 'unsubscribe',
  effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
  ...over,
});

beforeEach(() => {
  db.tables = { contact_governance_records: [], suppression_entries: [] };
  db.failures = {};
  db.queries = [];
  db.nextId = 1;
});

const tablesTouched = (): string[] => [...new Set(db.queries.map((q) => q.table))];

describe('A3 — isSuppressed reads the canonical store first', () => {
  it('a canonical unsubscribe suppresses, and says which store answered', async () => {
    db.tables.contact_governance_records = [govRow()];

    const r = await isSuppressed(ORG_A, 'email', TARGET);

    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe('unsubscribe');
    expect(r.store).toBe('canonical');
  });

  it('a canonical DEFERMENT still means "do not send now"', async () => {
    db.tables.contact_governance_records = [govRow({
      governance_type: 'deferred', effective_until: '2099-01-01T00:00:00.000Z',
    })];

    const r = await isSuppressed(ORG_A, 'email', TARGET);
    expect(r.suppressed).toBe(true);
    expect(r.store).toBe('canonical');
  });

  it('a REVOKED canonical record does not suppress', async () => {
    db.tables.contact_governance_records = [govRow({ revoked_at: '2026-02-01T00:00:00.000Z' })];
    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);
  });

  it('another tenant’s canonical record never suppresses this tenant', async () => {
    db.tables.contact_governance_records = [govRow({ organization_id: 'other-tenant' })];
    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);
  });

  it('nothing anywhere means not suppressed — the convergence did not make it fail-closed by default', async () => {
    const r = await isSuppressed(ORG_A, 'email', TARGET);
    expect(r.suppressed).toBe(false);
    expect(tablesTouched()).toEqual(expect.arrayContaining(['contact_governance_records', 'suppression_entries']));
  });
});

describe('A3 — the legacy store still blocks until it is formally retired', () => {
  it('a legacy row suppresses when the canonical store is silent', async () => {
    db.tables.suppression_entries = [{
      target: NORMALISED, active: true, channel: '*', company_id: ORG_A,
      reason: 'manual', scope: 'tenant',
    }];

    const r = await isSuppressed(ORG_A, 'email', TARGET);
    expect(r.suppressed).toBe(true);
    expect(r.store).toBe('legacy');
  });

  it('a GLOBAL legacy row suppresses — the one scope canonical cannot express', async () => {
    db.tables.suppression_entries = [{
      target: NORMALISED, active: true, channel: '*', company_id: '__global__',
      reason: 'legal_hold', scope: 'global',
    }];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(true);
  });
});

describe('A3 — both reads FAIL CLOSED', () => {
  it('an unreadable canonical table suppresses', async () => {
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };
    const r = await isSuppressed(ORG_A, 'email', TARGET);
    expect(r).toMatchObject({ suppressed: true, reason: 'governance_lookup_failed_failclosed', store: 'canonical' });
  });

  it('an unreadable legacy table suppresses', async () => {
    db.failures.suppression_entries = { code: '08006', message: 'connection failure' };
    const r = await isSuppressed(ORG_A, 'email', TARGET);
    expect(r).toMatchObject({ suppressed: true, reason: 'suppression_lookup_error_failclosed', store: 'legacy' });
  });

  it('a governance question with no tenant is refused, not guessed', async () => {
    const r = await isSuppressed('', 'email', TARGET);
    expect(r).toMatchObject({ suppressed: true, reason: 'suppression_no_tenant_failclosed' });
    expect(db.queries).toHaveLength(0);
  });

  it('an empty target is not a suppression — it is nothing to check', async () => {
    expect(await isSuppressed(ORG_A, 'email', '  ')).toEqual({ suppressed: false });
  });
});

describe('A3 — writes land in the canonical store', () => {
  it('a tenant-scoped suppression is written canonically AND to the legacy table', async () => {
    const r = await addSuppression({ companyId: ORG_A, channel: 'email', target: TARGET, reason: 'unsubscribe' });

    expect(r.canonicalId).toBeTruthy();
    expect(r.id).toBeTruthy();
    expect(db.tables.contact_governance_records).toHaveLength(1);
    expect(db.tables.contact_governance_records[0]).toMatchObject({
      organization_id: ORG_A, channel: 'email', governance_type: 'unsubscribe',
      target_normalized: NORMALISED,
    });
    // ...and it is immediately enforced by the canonical read path.
    expect((await isSuppressed(ORG_A, 'email', TARGET)).store).toBe('canonical');
  });

  it('a GLOBAL suppression stays legacy-only — canonical governance is never tenant-less', async () => {
    const r = await addSuppression({ companyId: null, target: TARGET, reason: 'legal_hold' });

    expect(r.canonicalId).toBeNull();
    expect(db.tables.contact_governance_records).toHaveLength(0);
    expect(db.tables.suppression_entries[0]).toMatchObject({ company_id: '__global__', scope: 'global' });
  });

  it('a canonical write failure is NOT reported as success', async () => {
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };
    await expect(
      addSuppression({ companyId: ORG_A, channel: 'email', target: TARGET, reason: 'unsubscribe' }),
    ).rejects.toThrow();
  });

  it('release REVOKES the canonical record rather than deleting it', async () => {
    db.tables.contact_governance_records = [govRow({ channel: 'email' })];

    const r = await releaseSuppression(ORG_A, 'email', TARGET);

    expect(r.canonicalRevoked).toBe(1);
    // ADR §16 — the row survives, carrying its revocation.
    expect(db.tables.contact_governance_records).toHaveLength(1);
    expect(db.tables.contact_governance_records[0].revoked_at).toBeTruthy();
    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);
  });

  it('release does NOT silently narrow a broader "*" instruction', async () => {
    db.tables.contact_governance_records = [govRow({ channel: '*' })];

    const r = await releaseSuppression(ORG_A, 'email', TARGET);

    expect(r.canonicalRevoked).toBe(0);
    expect(db.tables.contact_governance_records[0].revoked_at).toBeNull();
  });
});

describe('A3 — the reason mapping honours the canonical CHECK constraints', () => {
  it('an all-channel do-not-contact becomes dnc_permanent', () => {
    // contact_governance_permanent_is_all_channels
    for (const reason of ['dsar', 'legal_hold', 'manual'] as const) {
      expect(toGovernanceType(reason, '*')).toBe('dnc_permanent');
    }
  });

  it('a channel-scoped do-not-contact becomes dnc_channel', () => {
    // contact_governance_channel_dnc_is_specific
    for (const reason of ['dsar', 'legal_hold', 'manual'] as const) {
      expect(toGovernanceType(reason, 'email')).toBe('dnc_channel');
    }
  });

  it('the reasons with a direct counterpart map straight across', () => {
    expect(toGovernanceType('unsubscribe', 'email')).toBe('unsubscribe');
    expect(toGovernanceType('consent_withdrawn', 'email')).toBe('consent_withdrawn');
    expect(toGovernanceType('complaint', 'email')).toBe('complaint');
    expect(toGovernanceType('bounce', 'email')).toBe('bounce_hard');
  });
});

describe('A3 — no second governance engine', () => {
  it('the suppression seam calls mayContact and reimplements no rule', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', 'services', 'execution', 'suppressionService.ts'), 'utf8',
    );
    expect(src).toMatch(/import \{ mayContact/);
    // The governance vocabulary is never re-spelled here; it is imported.
    for (const t of ['dnc_permanent', 'dnc_channel', 'bounce_hard']) {
      expect(src.match(new RegExp(`'${t}'`, 'g'))!.length).toBe(1);
    }
  });
});
