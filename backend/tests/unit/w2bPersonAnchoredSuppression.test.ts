/**
 * WP2 — person-anchored suppression at the Path A seam.
 *
 * Adopted from the W2-B suite in the r1-ctx worktree: only the C-1 cases (Path A
 * resolves the person behind a recipient) and the canonical-first precedence
 * cases. The C-2/C-3/D-4 cases there test legacy-write changes that WP2 did not
 * adopt, so they are not carried.
 *
 *   C-1  Path A supplied no person anchor, so a canonical record anchored to a
 *        PERSON with no target was reported as "not suppressed".
 *
 * Everything here runs against a double of the database. It proves control flow,
 * query shape and precedence. It does NOT prove PostgREST behaviour or real
 * constraint enforcement.
 */

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  /** Tables that answer with a PostgREST-shaped error. */
  failures: {} as Record<string, { code: string; message: string }>,
  /** Tables whose client THROWS — a transport fault, not a query error. */
  throws: {} as Record<string, string>,
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

    /**
     * `uq_contact_governance_identity`, emulated:
     *   (organization_id, channel, governance_type, coalesce(person_id, target_normalized))
     *   among rows WHERE revoked_at IS NULL
     * Without it a replay would simply append a second row here and the
     * idempotency assertions below would be testing nothing.
     */
    const canonicalAnchor = (r: Row): unknown => r.person_id ?? r.target_normalized ?? null;
    const canonicalCollision = (candidate: Row): boolean =>
      rows().some((r) => (r.revoked_at ?? null) === null
        && r.organization_id === candidate.organization_id
        && r.channel === candidate.channel
        && r.governance_type === candidate.governance_type
        && canonicalAnchor(r) === canonicalAnchor(candidate));

    const exec = async (mode: 'many' | 'maybe'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.queries.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      if (db.throws[table]) throw new Error(db.throws[table]);
      const failure = db.failures[table];
      if (failure) return { data: null, error: failure };

      if (st.op === 'insert' || st.op === 'upsert') {
        // Mirror the column defaults the real schema applies (20261003000000);
        // without them a freshly written record reads back with no start instant
        // and `mayContact` correctly judges it not yet in force — a defect of the
        // double, not of the code under test.
        const defaults: Row = table === 'contact_governance_records'
          ? { effective_from: new Date(0).toISOString(), effective_until: null, revoked_at: null, person_id: null, target_normalized: null }
          : {};
        const candidate = { ...defaults, ...(st.payload as Row) };

        if (table === 'contact_governance_records' && canonicalCollision(candidate)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_contact_governance_identity"' } };
        }
        // `uq_suppression (company_id, channel, target)` — the upsert target.
        if (st.op === 'upsert' && table === 'suppression_entries') {
          const existing = rows().find((r) => r.company_id === candidate.company_id && r.channel === candidate.channel && r.target === candidate.target);
          if (existing) { Object.assign(existing, candidate); return { data: existing, error: null }; }
        }

        const created = { id: `${table}-${db.nextId++}`, ...candidate };
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
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => exec('many').then(resolve, reject),
    };
    return b;
  },
}));

// Path A's caller, with every stage before and after suppression stubbed open,
// so the only thing that can stop the connector is the suppression gate.
const connectorCalls: unknown[] = [];
jest.mock('../../services/execution/executionControlService', () => ({
  isExecutionEnabled: async () => ({ enabled: true, reason: 'enabled' }),
}));
jest.mock('../../services/execution/executionApprovalService', () => ({
  getApprovalDecision: async () => ({ approved: true, approver: 'op-1', reason: 'approved' }),
}));
jest.mock('../../services/execution/executionAuditService', () => ({
  recordExecutionAudit: async () => undefined,
}));
jest.mock('../../services/execution/executionQuotaService', () => ({
  checkQuota: async () => ({ allowed: true, evidence: {} }),
}));
jest.mock('../../services/execution/emailExecutionConnector', () => {
  const actual = jest.requireActual('../../services/execution/emailExecutionConnector');
  return {
    ...actual,
    dispatchEmail: async (input: unknown) => { connectorCalls.push(input); return { dispatched: false, idempotencyKey: 'k' }; },
  };
});

import { isSuppressed } from '../../services/execution/suppressionService';
import { dispatchGuarded } from '../../services/execution/executionBridge';
import { evaluateGovernance } from '../../services/leadOutreachExecution/governance';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const PERSON = '00000000-0000-4000-8000-000000000001';
const PERSON_2 = '00000000-0000-4000-8000-000000000002';
const TARGET = 'CTO@Example.Test';
const NORMALISED = 'cto@example.test';

/** A canonical record. `person_id` / `target_normalized` are set per test. */
const govRow = (over: Row = {}): Row => ({
  id: 'g1', organization_id: ORG_A, person_id: null, target_normalized: NORMALISED,
  channel: '*', governance_type: 'unsubscribe',
  effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
  ...over,
});

/**
 * An `identity_claims` row — the canonical endpoint-to-person link. `platform` is
 * NULL for email and phone, which is why the real uniqueness index is NULLS NOT
 * DISTINCT.
 */
const claim = (over: Row = {}): Row => ({
  id: `c-${db.nextId++}`, organization_id: ORG_A, person_id: PERSON,
  claim_type: 'email', platform: null, normalized_value: NORMALISED, revoked_at: null,
  ...over,
});

const legacyRow = (over: Row = {}): Row => ({
  id: 'se-1', company_id: ORG_A, channel: 'email', target: NORMALISED,
  reason: 'manual', scope: 'tenant', active: true, released_at: null,
  ...over,
});

beforeEach(() => {
  db.tables = { contact_governance_records: [], suppression_entries: [], identity_claims: [] };
  db.failures = {};
  db.throws = {};
  db.queries = [];
  db.nextId = 1;
  connectorCalls.length = 0;
});

// ── Phase 1 — C-1: a person-anchored restriction must reach Path A ───────────
describe('W2-B/C-1 — Path A resolves the person behind a recipient', () => {
  it('1. a PERSON-ANCHORED unsubscribe suppresses, though the caller supplied only an address', async () => {
    // The exact shape the W1 unsubscribe writer produces: anchored to the person,
    // no target at all. Before W2-B this read as `{ suppressed: false }`.
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null, channel: 'email' })];

    const r = await isSuppressed(ORG_A, 'email', TARGET);

    expect(r.suppressed).toBe(true);
    expect(r.store).toBe('canonical');
    expect(r.reason).toBe('unsubscribe');
  });

  it('2. the verdict reports that it matched on the PERSON, not the address', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null, channel: 'email' })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).scope).toBe('person');
  });

  it('3. TARGET-anchored restrictions are untouched — the old path still works', async () => {
    db.tables.contact_governance_records = [govRow()];   // target-anchored, no claim at all

    const r = await isSuppressed(ORG_A, 'email', TARGET);
    expect(r.suppressed).toBe(true);
    expect(r.scope).toBe('target');
  });

  it('4. the claim lookup is TENANT-FIRST and does not widen the read', async () => {
    db.tables.identity_claims = [claim()];
    await isSuppressed(ORG_A, 'email', TARGET);

    const q = db.queries.find((x) => x.table === 'identity_claims');
    expect(q).toBeDefined();
    const cols = q!.filters.map(([, col]) => col);
    expect(cols[0]).toBe('organization_id');             // tenant FIRST, always
    expect(cols).toEqual(expect.arrayContaining(['normalized_value', 'revoked_at', 'claim_type']));
  });

  it('5. ANOTHER TENANT’s claim on the same address resolves no person here', async () => {
    db.tables.identity_claims = [claim({ organization_id: ORG_B })];
    // Their person-anchored restriction must not reach us, and their claim must
    // not anchor us to their person.
    db.tables.contact_governance_records = [govRow({ organization_id: ORG_B, person_id: PERSON, target_normalized: null })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);
  });

  it('6. a person-anchored restriction in THIS tenant does not leak to another', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null })];

    expect((await isSuppressed(ORG_B, 'email', TARGET)).suppressed).toBe(false);
  });

  it('7. a REVOKED claim resolves no person — the tenant withdrew that belief', async () => {
    db.tables.identity_claims = [claim({ revoked_at: '2026-03-01T00:00:00.000Z' })];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null })];

    // Deliberate, and consistent with `personErasure.loadContactPoints`, which
    // excludes revoked claims for the same reason.
    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);
  });

  it('8. an AMBIGUOUS address — two persons claiming it — FAILS CLOSED', async () => {
    db.tables.identity_claims = [
      claim({ claim_type: 'email', person_id: PERSON }),
      claim({ claim_type: 'phone', person_id: PERSON_2 }),
    ];

    // channel '*' asks for both contact claim types, so both rows are candidates.
    const r = await isSuppressed(ORG_A, '*', TARGET);

    expect(r).toMatchObject({
      suppressed: true,
      reason: 'governance_person_resolution_failed_failclosed',
      store: 'canonical',
    });
  });

  it('9. an UNREADABLE claims table FAILS CLOSED, and says so distinctly', async () => {
    db.failures.identity_claims = { code: '08006', message: 'connection failure' };

    const r = await isSuppressed(ORG_A, 'email', TARGET);

    expect(r.suppressed).toBe(true);
    // NOT the governance-table reason: an operator must not be sent to the wrong table.
    expect(r.reason).toBe('governance_person_resolution_failed_failclosed');
  });

  it('10. a THROWING claims client FAILS CLOSED too', async () => {
    db.throws.identity_claims = 'socket hang up';

    const r = await isSuppressed(ORG_A, 'email', TARGET);
    expect(r).toMatchObject({ suppressed: true, reason: 'governance_person_resolution_failed_failclosed' });
  });

  it('11. an unreadable GOVERNANCE table still fails closed with its own reason', async () => {
    db.tables.identity_claims = [claim()];
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };

    const r = await isSuppressed(ORG_A, 'email', TARGET);
    expect(r).toMatchObject({ suppressed: true, reason: 'governance_lookup_failed_failclosed', store: 'canonical' });
  });

  it('12. an EMAIL claim is not used to resolve a PHONE channel', async () => {
    db.tables.identity_claims = [claim({ claim_type: 'email' })];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null, channel: 'phone' })];

    // The phone channel asks only for phone claims, so this address anchors nothing.
    expect((await isSuppressed(ORG_A, 'phone', '+1 555 010 0000')).suppressed).toBe(false);
  });

  it('13. a person-anchored record on ANOTHER channel does not block this one', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null, channel: 'phone' })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);
  });

  it('14. an unanchorable or tenant-less question NEVER becomes an authorization', async () => {
    expect(await isSuppressed(ORG_A, 'email', '   ')).toEqual({ suppressed: false });
    // ...and it reads nothing at all, so it cannot be mistaken for a decision.
    expect(db.queries).toHaveLength(0);

    const noTenant = await isSuppressed('', 'email', TARGET);
    expect(noTenant).toMatchObject({ suppressed: true, reason: 'suppression_no_tenant_failclosed' });
    expect(db.queries).toHaveLength(0);
  });
});

describe('W2-B — canonical-first precedence is intact on both paths', () => {
  it('29. Path A: a canonical block answers before the legacy store is read at all', async () => {
    db.tables.contact_governance_records = [govRow()];

    const r = await isSuppressed(ORG_A, 'email', TARGET);

    expect(r.store).toBe('canonical');
    expect(db.queries.some((q) => q.table === 'suppression_entries')).toBe(false);
  });

  it('30. Path A: a legacy row can ADD a suppression but can never lift a canonical one', async () => {
    db.tables.contact_governance_records = [govRow()];
    // A released legacy row is not a release of the canonical instruction.
    db.tables.suppression_entries = [legacyRow({ active: false, released_at: '2026-04-01T00:00:00.000Z' })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).store).toBe('canonical');
  });

  it('31. Path A: a legacy-only row still blocks while the store is retained', async () => {
    db.tables.suppression_entries = [legacyRow({ channel: '*' })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).store).toBe('legacy');
  });

  it('32. Path A: a GLOBAL legacy row still blocks — D-1 retires nothing in this slice', async () => {
    db.tables.suppression_entries = [legacyRow({ company_id: '__global__', channel: '*', scope: 'global', reason: 'legal_hold' })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(true);
  });

  it('33. Path B: the canonical verdict decides before any legacy scope is consulted', () => {
    const base = {
      task: { id: 't-1', planTaskId: null, leadId: 'L1', channel: 'email', companyId: ORG_A, requiresApproval: false } as never,
      config: { companyId: ORG_A, configured: true, enabled: true, killSwitch: false, enabledChannels: ['email'], restrictedRegions: [], dailyLimitTenant: null, dailyLimitLead: null },
      usage: { tenantCount: 0, leadCount: 0, windowHours: 24, layer: 'db' as const },
      globalKillSwitch: false,
      region: null,
      evaluatedAt: '2026-05-01T00:00:00.000Z',
    };

    const canonicalBlocks = evaluateGovernance({
      ...base,
      suppressions: { task: false, lead: false, channel: false, recipient: false },
      canonicalGovernance: {
        decision: 'blocked', gate: 4, governanceType: 'unsubscribe', recordId: 'g1',
        matchedBy: 'person', reason: 'blocked_by_unsubscribe', deferredUntil: null, version: 'li3c',
      },
    });
    expect(canonicalBlocks.decision).toBe('blocked');
    expect(canonicalBlocks.blockingCondition).toBe('governance.unsubscribe');

    // ...and with canonical silent, a legacy scope can still ADD a block.
    const legacyAdds = evaluateGovernance({
      ...base,
      suppressions: { task: false, lead: false, channel: false, recipient: true },
      canonicalGovernance: null,
    });
    expect(legacyAdds.decision).toBe('blocked');
    expect(legacyAdds.blockingCondition).toBe('suppression.recipient');
  });
});

describe('WP2 — Path A refuses BEFORE the connector is invoked', () => {
  const request = () => ({
    companyId: ORG_A, campaignId: 'camp-1', entityId: 'ent-1', channel: 'email' as const,
    recipient: TARGET, message: { subject: 'Hello', body: 'Body', messageId: 'm-1' } as never,
    actor: 'op-1',
  });

  it('a PERSON-ANCHORED unsubscribe stops dispatchGuarded at the suppression stage', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null, channel: 'email' })];

    const r = await dispatchGuarded(request());

    expect(r.outcome).toBe('suppressed');
    expect(r.blockedAt).toBe('suppression');
    expect(connectorCalls).toHaveLength(0);
  });

  it('control: with no restriction the same request reaches the connector', async () => {
    db.tables.identity_claims = [claim()];

    const r = await dispatchGuarded(request());

    expect(r.outcome).toBe('dry_run');
    expect(connectorCalls).toHaveLength(1);
  });
});
