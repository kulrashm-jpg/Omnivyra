/**
 * P-SM1 — /api/activity-workspace/[id]/shared-media against the PRODUCTION schema.
 *
 * daily_content_plans has no organization_id column in production. The route used
 * to select it, so every request failed with 500 "load failed" before its tenant
 * check (found by the 2026-11-08 E2E isolation run, probes ACT-a-02 / ACT-b-06).
 * The mock below rejects that column exactly as PostgREST does (42703).
 *
 * Asserts: the row loads; writes are tenant-stamped with the AUTHORISED company
 * (the campaign's company), never a request value; a cross-tenant caller is
 * refused before any write.
 */
const PLAN_COLUMNS_IN_PRODUCTION = ['id', 'campaign_id', 'content', 'content_type', 'intent_type'];
const writes: Array<{ table: string; op: string; row: any }> = [];
let accessGranted = true;
const builtInputs: any[] = [];
// The plan row as PostgREST serves it: a select naming a column production does not have fails 42703. Shared by the
// raw client and the seam path (S2 tier 2: the owner link and the row itself are now read through ownedDbTable).
function mockPlanRead(cols: string): { data: any; error: any } {
  const bad = cols.split(',').map((s) => s.trim()).filter((c) => !PLAN_COLUMNS_IN_PRODUCTION.includes(c));
  if (bad.length) return { data: null, error: { code: '42703', message: `column daily_content_plans.${bad[0]} does not exist` } };
  return { data: { id: 'row-1', campaign_id: 'camp-1', content: JSON.stringify({ target_platforms: ['linkedin'] }), content_type: 'image', intent_type: 'creator' }, error: null };
}

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/creator/intelligence/workspace', () => ({ isCreatorWorkspaceLifecycleEnabled: () => true }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async ({ res, companyId }: any) => {
    if (!accessGranted) { res.status(403).json({ error: 'FORBIDDEN' }); return null; }
    return { userId: 'user-a', companyId };
  }),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let cols = '*';
      const api: any = {
        select: (c: string) => { cols = c; return api; },
        eq: () => api, limit: () => api, order: () => api, in: () => api,
        maybeSingle: async () => {
          if (table === 'daily_content_plans') return mockPlanRead(cols);
          if (table === 'campaigns') return { data: { company_id: 'c0a00000-0000-4000-8000-00000000000a' }, error: null };
          return { data: null, error: null };
        },
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      return api;
    },
  },
}));
// Company ids are uuid-shaped, as every real one: the tenant seam (tenantContextFor) refuses anything else.
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Record<string, unknown> = {};
    const api: any = {
      upsert: async (row: any) => { writes.push({ table, op: 'upsert', row }); return { data: null, error: null }; },
      update: (row: any) => { writes.push({ table, op: 'update', row }); return api; },
      eq: async () => ({ data: null, error: null }),
      // Read: tenantChildTable('content_asset_attachment', …) verifies its parent content_core_asset rows (by
      // content_core_id) - served from the rows this request upserted, as the database would.
      select: (c?: string) => {
        const cols = c ?? '*';
        const r: any = {
          eq: (k: string, v: unknown) => { filters[k] = v; return r; },
          limit: async () => {
            // S2 tier 2: ownerOfChildRow reads the plan's campaign link, then the campaign's company, through the seam.
            if (table === 'daily_content_plans') {
              const out = mockPlanRead(cols);
              return out.error ? out : { data: [out.data], error: null };
            }
            if (table === 'campaigns') return { data: [{ id: 'camp-1', company_id: 'c0a00000-0000-4000-8000-00000000000a' }], error: null };
            return {
              data: writes.filter((w) => w.table === table && w.op === 'upsert'
                && Object.entries(filters).every(([k, v]) => w.row[k] === v)).map((w) => w.row),
              error: null,
            };
          },
          // S2 tier 2: the tenantChildTable parent re-read (campaigns under the tenant), the plan row itself, and the
          // lineage reads (content_external_video_asset / content_core_asset, now under the tenant) - the same answers
          // the raw client gave for them.
          maybeSingle: async () => {
            if (table === 'daily_content_plans') return mockPlanRead(cols);
            if (table === 'campaigns') return { data: { id: 'camp-1', company_id: 'c0a00000-0000-4000-8000-00000000000a' }, error: null };
            return { data: null, error: null };
          },
        };
        return r;
      },
    };
    return api;
  },
}));
jest.mock('../../services/creator/media', () => ({
  resolveSharedMediaInheritance: jest.fn(() => ({ platforms: {} })),
  finalizeRowSharedMedia: jest.fn(() => ({})),
  finalizeRowSharedVideo: jest.fn(() => ({})),
  buildExternalVideoAttachment: jest.fn((input: any) => {
    builtInputs.push(input);
    // content_core_id on the rows, as the real builder sets it: the attachment's tenant check reads the core row by it.
    return {
      external_video_row: { organization_id: input.organizationId, content_core_id: input.contentCoreId },
      core_asset_row: { organization_id: input.organizationId, content_core_id: input.contentCoreId },
      attachment_row: { content_core_id: input.contentCoreId },
    };
  }),
}));
jest.mock('../../services/creator/finalizeCreatorRowMedia', () => ({ finalizeCreatorRowMediaLifecycle: jest.fn(async () => ({})) }));

import fs from 'fs';
import path from 'path';
import handler from '../../../pages/api/activity-workspace/[id]/shared-media';

function call(method: string, body: Record<string, unknown> = {}) {
  const r: any = { statusCode: 0, body: null, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return (handler as any)({ method, query: { id: 'row-1' }, body, headers: {} }, r).then(() => r);
}

beforeEach(() => { writes.length = 0; builtInputs.length = 0; accessGranted = true; });

describe('P-SM1 shared-media on the production schema', () => {
  it('GET loads the row (no 500 "load failed")', async () => {
    const r = await call('GET');
    expect(r.statusCode).toBe(200);
    expect(r.body?.error).not.toBe('load failed');
  });

  it('PATCH attach stamps content_core_asset with the authorised company, not a request value', async () => {
    const r = await call('PATCH', { action: 'attach', asset_id: 'asset-1', organization_id: 'c0b00000-0000-4000-8000-00000000000b' });
    expect(r.statusCode).toBe(200);
    const core = writes.find((w) => w.table === 'content_core_asset');
    expect(core?.row.organization_id).toBe('c0a00000-0000-4000-8000-00000000000a');
  });

  it('PATCH attach-external-video builds the attachment for the authorised company', async () => {
    const r = await call('PATCH', { action: 'attach-external-video', external_video_url: 'https://video.example.test/v.mp4', organization_id: 'c0b00000-0000-4000-8000-00000000000b' });
    expect(r.statusCode).toBe(200);
    expect(builtInputs[0]?.organizationId).toBe('c0a00000-0000-4000-8000-00000000000a');
    expect(writes.find((w) => w.table === 'content_external_video_asset')?.row.organization_id).toBe('c0a00000-0000-4000-8000-00000000000a');
  });

  it('a cross-tenant caller is refused (403) before any write', async () => {
    accessGranted = false;
    const r = await call('PATCH', { action: 'attach', asset_id: 'asset-1' });
    expect(r.statusCode).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('source guard: the plan select never asks for organization_id again', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../pages/api/activity-workspace/[id]/shared-media.ts'), 'utf8');
    // S2 tier 2: the plan row is read through the seam handle (tenantChildTable('daily_content_plans', ...) -> rowTable)
    // as well as raw sibling reads. EVERY plan select is checked, and the seam read must be among them (positive control).
    const raw = [...src.matchAll(/from\('daily_content_plans'\)[\s\S]*?\.select\('([^']*)'\)/g)].map((m) => m[1]);
    const seam = [...src.matchAll(/tenantChildTable\('daily_content_plans'[\s\S]*?\.select\('([^']*)'\)/g)].map((m) => m[1]);
    expect(seam.length).toBeGreaterThan(0);
    expect(seam[0]).toContain('intent_type');
    for (const sel of [...raw, ...seam]) {
      expect(sel.split(',').map((s) => s.trim())).not.toContain('organization_id');
    }
  });
});
