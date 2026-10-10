/**
 * D4 — GET /api/governance/campaign-status must not present a blueprint-state
 * READ FAILURE as a confirmed lock.
 *
 * getBlueprintBlockReason used to map every non-policy error to 'IMMUTABLE',
 * so a failed read rendered the red "Blueprint Locked — Campaign In Execution"
 * banner: a fabricated verdict. It is now 'UNAVAILABLE', surfaced as
 * `blueprintStateUnavailable` with both lock flags false.
 *
 * The REAL route and the REAL guard run over a table-level fake; only the
 * auth/tenancy seams and the version store are stubbed.
 */
type Row = Record<string, unknown>;
let campaignRow: Row | null = null;
let postRows: Row[] = [];
let failingTables: string[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit', 'order', 'in']) q[m] = () => q;
      const result = (): { data: unknown; error: { code: string; message: string } | null } =>
        failingTables.includes(table)
          ? { data: null, error: { code: 'XX000', message: `forced failure on ${table}` } }
          : { data: table === 'campaigns' ? campaignRow : table === 'scheduled_posts' ? postRows : null, error: null };
      q.maybeSingle = async () => {
        const r = result();
        return r.error ? r : { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null };
      };
      q.then = (ok: (r: unknown) => unknown) => Promise.resolve(result()).then(ok);
      return q;
    },
  },
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: 'user-1' }, error: null }),
}));
jest.mock('../../middleware/authMiddleware', () => ({ requireCompanyAccess: async () => true }));
jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersionByCampaignId: async () => ({ company_id: 'co-1', campaign_snapshot: {} }),
}));

import campaignStatusHandler from '../../../pages/api/governance/campaign-status';
import { invoke } from '../helpers/routeAuthHarness';

const HOURS = 3600000;
const at = (h: number) => new Date(Date.now() + h * HOURS).toISOString();
const get = () => invoke(campaignStatusHandler, { method: 'GET', query: { campaignId: 'camp-1' } });
type Governance = { blueprintImmutable: boolean; blueprintFrozen: boolean; blueprintStateUnavailable: boolean };
const governanceOf = (body: unknown): Governance => (body as { governance: Governance }).governance;

beforeEach(() => {
  campaignRow = { id: 'camp-1', company_id: 'co-1', blueprint_status: 'ACTIVE', duration_weeks: 4 };
  postRows = [];
  failingTables = [];
  delete process.env.BLUEPRINT_PER_ITEM_LOCKS;
});

describe('campaign-status — blueprint lock presentation (D4)', () => {
  it('a blueprint-state READ FAILURE is reported as unavailable — never as a confirmed IMMUTABLE lock', async () => {
    failingTables = ['scheduled_posts'];
    const res = await get();
    expect(res.status).toBe(200);
    expect(governanceOf(res.body)).toMatchObject({
      blueprintImmutable: false,
      blueprintFrozen: false,
      blueprintStateUnavailable: true,
    });
  });

  it('a confirmed lock is still IMMUTABLE (and not unavailable)', async () => {
    postRows = [{ id: 'sp-1', status: 'published', scheduled_for: at(-5) }];
    const res = await get();
    expect(governanceOf(res.body)).toMatchObject({
      blueprintImmutable: true,
      blueprintFrozen: false,
      blueprintStateUnavailable: false,
    });
  });

  it('a mutable blueprint reports all three flags false', async () => {
    postRows = [{ id: 'sp-1', status: 'cancelled', scheduled_for: at(-5) }];
    const res = await get();
    expect(governanceOf(res.body)).toMatchObject({
      blueprintImmutable: false,
      blueprintFrozen: false,
      blueprintStateUnavailable: false,
    });
  });
});
