/**
 * closure-B — operations history continuity across lead aliases.
 *
 * A lead absorbed by verified-identity reconciliation (prospect_aliases) or
 * folded by the signal merge keeps every note / status / assignment / task
 * written under its OLD key. These tests drive the REAL route
 * (`/api/lead-intelligence/operations`), the REAL operational core service and
 * the REAL unified read service over the shared tenant-filtering route-auth
 * harness, and prove:
 *   - GET by the canonical key OR by an old key returns history written under
 *     any key of the same lead;
 *   - every mutation writes under the CANONICAL key (old rows are never re-keyed);
 *   - one active assignment per lead, whichever key it was made under;
 *   - nothing resolves across tenants (tenant B has identical ids + an alias-keyed
 *     note carrying the canary);
 *   - `resolveOperationalAliases` is per-company, fail-open, and leaves other
 *     entity types alone.
 */
import {
  seed, invoke, rows, leaksB, resolveUpsertConflicts, CO_A, CO_B, USER_A, USER_B, CANARY_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const opsRoute = require('../../../pages/api/lead-intelligence/operations').default;
const ops = require('../../services/operations/operationalCoreService');
const { resolveLeadKeyAliases } = require('../../services/leadIntelligence/leadIntelligenceReadService');
const { projectExistingRow, leadKeyFor } = require('../../../lib/leadIntelligence');
/* eslint-enable @typescript-eslint/no-var-requires */

const SURVIVOR = 'lead-s-00-0000-0000-00000000000s';
const ABSORBED = 'lead-x-00-0000-0000-00000000000x';

const prospect = (id: string, company: string, over: Record<string, unknown> = {}) => ({
  id, company_id: company, user_id: USER_A, source: 'apollo', created_at: '2026-10-20T10:00:00Z',
  qualification_score: 0, external_lead_key: `${id}-key`, lead_status: null, lead_metadata: {}, unified_person_id: null, ...over,
});
const keyOf = (row: Record<string, unknown>): string => leadKeyFor(projectExistingRow('crm', row, { readFrom: 'canonical_leads' }));

const survivorRow = prospect(SURVIVOR, CO_A, { unified_person_id: 'person-x' });
const absorbedRow = prospect(ABSORBED, CO_A, { source: 'community', created_at: '2026-10-01T10:00:00Z' });
// Tenant B: an IDENTICAL absorbed id (another tenant's row), no alias.
const absorbedRowB = prospect(ABSORBED, CO_B, { source: 'community', user_id: USER_B, created_at: '2026-10-01T10:00:00Z' });
const SURV_KEY = keyOf(survivorRow);
const ABS_KEY = keyOf(absorbedRow);

const note = (id: string, company: string, entityId: string, body: string, createdAt: string) => ({
  id, company_id: company, entity_type: 'canonical_lead', entity_id: entityId, author_id: USER_A, body, body_format: 'markdown',
  mentions: [], pinned: false, deleted_at: null, created_at: createdAt,
});

beforeAll(() => {
  resolveUpsertConflicts('operational_states', ['company_id', 'entity_type', 'entity_id']);
});

beforeEach(() => {
  seed({
    canonical_leads: [survivorRow, absorbedRow, absorbedRowB],
    prospect_aliases: [{
      id: 'pa-1', organization_id: CO_A, alias_lead_id: ABSORBED, survivor_lead_id: SURVIVOR,
      reason: 'verified_identity', rule_version: 'cb.reconcile.1', evidence: {}, created_at: '2026-10-25T00:00:00Z',
    }],
    operational_notes: [
      note('n-old', CO_A, ABS_KEY, 'written under the absorbed key', '2026-10-02T00:00:00Z'),
      note('n-new', CO_A, SURV_KEY, 'written under the canonical key', '2026-10-21T00:00:00Z'),
      note('n-b', CO_B, ABS_KEY, `tenant B note ${CANARY_B}`, '2026-10-03T00:00:00Z'),
    ],
    operational_states: [
      { id: 'st-old', company_id: CO_A, entity_type: 'canonical_lead', entity_id: ABS_KEY, status: 'qualified', changed_at: '2026-10-02T00:00:00Z' },
    ],
    operational_assignments: [
      { id: 'as-old', company_id: CO_A, entity_type: 'canonical_lead', entity_id: ABS_KEY, assignee_id: USER_A, active: true, assigned_at: '2026-10-02T00:00:00Z' },
    ],
    operational_tasks: [
      { id: 't-old', company_id: CO_A, entity_type: 'canonical_lead', entity_id: ABS_KEY, title: 'call back', status: 'open', created_at: '2026-10-02T00:00:00Z' },
    ],
  });
});

describe('unified reader — key resolution (tenant-scoped)', () => {
  it('the absorbed key and the canonical key both resolve to the survivor', async () => {
    const m = await resolveLeadKeyAliases(CO_A, [ABS_KEY, SURV_KEY, 'id::crm::canonical_leads::nope']);
    expect(m.get(ABS_KEY)).toEqual({ leadKey: SURV_KEY, aliasKeys: [ABS_KEY] });
    expect(m.get(SURV_KEY)).toEqual({ leadKey: SURV_KEY, aliasKeys: [ABS_KEY] });
    expect(m.has('id::crm::canonical_leads::nope')).toBe(false);
  });

  it('tenant B\'s identical key resolves to tenant B\'s own (unaliased) lead only', async () => {
    const m = await resolveLeadKeyAliases(CO_B, [ABS_KEY, SURV_KEY]);
    expect(m.get(ABS_KEY)).toEqual({ leadKey: ABS_KEY, aliasKeys: [] });
    expect(m.has(SURV_KEY)).toBe(false);
  });
});

describe('GET /api/lead-intelligence/operations — history under every key of the lead', () => {
  it.each([['the canonical key', SURV_KEY], ['the absorbed (old) key', ABS_KEY]])('by %s', async (_l, key) => {
    const r = await invoke(opsRoute, { as: 'A', query: { company_id: CO_A, entity_id: key } });
    expect(r.status).toBe(200);
    expect(r.body.notes.map((n: { id: string }) => n.id).sort()).toEqual(['n-new', 'n-old']);
    expect(r.body.status).toBe('qualified');       // saved under the old key
    expect(r.body.assignee).toBe(USER_A);          // saved under the old key
    expect(r.body.tasks.map((t: { id: string }) => t.id)).toEqual(['t-old']);
    expect(leaksB(r.body)).toBe(false);
  });

  it('tenant B asking with the same key sees ONLY tenant B\'s history', async () => {
    const r = await invoke(opsRoute, { as: 'B', query: { company_id: CO_B, entity_id: ABS_KEY } });
    expect(r.status).toBe(200);
    expect(r.body.notes.map((n: { id: string }) => n.id)).toEqual(['n-b']);
    expect(r.body.status).toBeNull();
  });

  it('a caller cannot read another company\'s overlay', async () => {
    const r = await invoke(opsRoute, { as: 'A', query: { company_id: CO_B, entity_id: ABS_KEY } });
    expect(r.status).toBe(403);
    expect(leaksB(r.body)).toBe(false);
  });
});

describe('POST /api/lead-intelligence/operations — new writes go to the canonical key', () => {
  it('add_note by the OLD key lands under the canonical key; the old note is not re-keyed', async () => {
    const r = await invoke(opsRoute, { as: 'A', method: 'POST', body: { company_id: CO_A, action: 'add_note', entity_id: ABS_KEY, body: 'after the merge' } });
    expect(r.status).toBe(201);
    const mine = rows('operational_notes').filter((n) => n.company_id === CO_A);
    expect(mine.find((n) => n.body === 'after the merge')!.entity_id).toBe(SURV_KEY);
    expect(mine.find((n) => n.id === 'n-old')!.entity_id).toBe(ABS_KEY);
    const g = await invoke(opsRoute, { as: 'A', query: { company_id: CO_A, entity_id: SURV_KEY } });
    expect(g.body.notes).toHaveLength(3);
  });

  it('set_status takes the status saved under the old key as `previous` and writes the canonical key', async () => {
    const r = await invoke(opsRoute, { as: 'A', method: 'POST', body: { company_id: CO_A, action: 'set_status', entity_id: ABS_KEY, status: 'working' } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'working', previous: 'qualified' });
    const st = rows('operational_states').filter((s) => s.company_id === CO_A);
    expect(st.find((s) => s.entity_id === SURV_KEY)).toMatchObject({ status: 'working', previous_status: 'qualified' });
    expect(st.find((s) => s.id === 'st-old')).toMatchObject({ entity_id: ABS_KEY, status: 'qualified' }); // history kept
    const g = await invoke(opsRoute, { as: 'A', query: { company_id: CO_A, entity_id: ABS_KEY } });
    expect(g.body.status).toBe('working'); // the canonical key's row is the current state
  });

  it('assign by the canonical key deactivates the assignment made under the old key: one active assignment per lead', async () => {
    const r = await invoke(opsRoute, { as: 'A', method: 'POST', body: { company_id: CO_A, action: 'assign', entity_id: SURV_KEY, assignee_id: 'user-new' } });
    expect(r.status).toBe(200);
    const as = rows('operational_assignments').filter((a) => a.company_id === CO_A);
    expect(as.filter((a) => a.active === true)).toEqual([expect.objectContaining({ entity_id: SURV_KEY, assignee_id: 'user-new' })]);
    expect(as.find((a) => a.id === 'as-old')).toMatchObject({ entity_id: ABS_KEY, active: false });
  });

  it('a key that names no lead is used exactly as given (unchanged behaviour)', async () => {
    const r = await invoke(opsRoute, { as: 'A', method: 'POST', body: { company_id: CO_A, action: 'add_note', entity_id: 'free-form-key', body: 'x' } });
    expect(r.status).toBe(201);
    expect(rows('operational_notes').find((n) => n.body === 'x')!.entity_id).toBe('free-form-key');
  });
});

describe('resolveOperationalAliases — per company, fail-open', () => {
  const ref = (companyId: string, entityId: string, entityType = 'canonical_lead') => ({ companyId, entityType, entityId });

  it('resolves each company with only its own keys; leaves other entity types alone', async () => {
    const seen: Array<[string, string[]]> = [];
    const resolver = async (companyId: string, keys: string[]) => {
      seen.push([companyId, [...keys]]);
      return new Map(companyId === CO_A ? [['k-old', { leadKey: 'k-canon', aliasKeys: ['k-old', 'k-other'] }]] : []);
    };
    const out = await ops.resolveOperationalAliases([ref(CO_A, 'k-old'), ref(CO_B, 'k-old'), ref(CO_A, 'aud-1', 'audience')], resolver);
    expect(seen).toEqual([[CO_A, ['k-old']], [CO_B, ['k-old']]]);
    expect(out[0]).toEqual({ companyId: CO_A, entityType: 'canonical_lead', entityId: 'k-canon', aliasEntityIds: ['k-old', 'k-other'] });
    expect(out[1]).toEqual(ref(CO_B, 'k-old'));
    expect(out[2]).toEqual(ref(CO_A, 'aud-1', 'audience'));
  });

  it('a resolver failure leaves every ref unchanged', async () => {
    const out = await ops.resolveOperationalAliases([ref(CO_A, 'k')], async () => { throw new Error('read failed'); });
    expect(out).toEqual([ref(CO_A, 'k')]);
  });

  it('without aliases the reads keep the exact single-key shape', async () => {
    const overlay = await ops.getOperationalOverlay(ref(CO_A, SURV_KEY));
    expect(overlay.notes.map((n: { id: string }) => n.id)).toEqual(['n-new']);
    expect(overlay.status).toBeNull();
  });
});
