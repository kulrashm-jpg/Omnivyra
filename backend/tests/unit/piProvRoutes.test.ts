/**
 * Lead-intelligence routes carry provenance, and stay tenant-locked (Agent 3).
 *
 * Real route handlers, real `resolveUserContext` / `enforceCompanyAccess`, real
 * read service and contribution reader — only the database is the shared
 * route-auth harness (tenant-filtering fake). Seeded: one canonical prospect per
 * tenant, each with its own provenance contribution, and a CANARY in company B's
 * contribution so any cross-tenant leak is visible in the response body.
 */
import { seed, invoke, leaksB, CO_A, CO_B, USER_A, CANARY_B } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const leadsRoute = require('../../../pages/api/lead-intelligence/leads').default;
const statsRoute = require('../../../pages/api/lead-intelligence/stats').default;
const exportRoute = require('../../../pages/api/lead-intelligence/export').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const LEAD_A = 'lead-a-00-0000-0000-00000000000a';
const LEAD_B = 'lead-b-00-0000-0000-00000000000b';

const prospect = (id: string, company: string) => ({
  id, company_id: company, user_id: USER_A, source: 'community', created_at: '2026-10-01T10:00:00Z',
  qualification_score: 40, external_lead_key: `${id}-key`, lead_status: null, lead_metadata: {}, unified_person_id: null,
});
const contributionOf = (id: string, lead: string, org: string, url: string) => ({
  id, organization_id: org, canonical_lead_id: lead, contribution_role: 'originating', source_category: 'community',
  external_ref: `community:${id}`, source_record_id: null, platform: 'reddit', source_url: url, contact_id: null,
  lead_signal_id: null, opportunity_feed_item_id: null, engagement_message_id: null,
  observed_at: '2026-10-01T09:00:00+00:00', evidence: {}, source_metadata: {}, created_at: '2026-10-01T10:00:00Z',
});

beforeEach(() => {
  seed({
    canonical_leads: [prospect(LEAD_A, CO_A), prospect(LEAD_B, CO_B)],
    prospect_source_contributions: [
      contributionOf('psc-a', LEAD_A, CO_A, 'https://reddit.com/r/a/1'),
      contributionOf('psc-b', LEAD_B, CO_B, `https://reddit.com/r/${CANARY_B}/1`),
      // A row claiming lead A under tenant B: must never surface for tenant A.
      contributionOf('psc-b-on-a', LEAD_A, CO_B, `https://reddit.com/r/${CANARY_B}/2`),
    ],
  });
});

describe('GET /api/lead-intelligence/leads — provenance', () => {
  it('401 without a session', async () => {
    const r = await invoke(leadsRoute, { query: { company_id: CO_A } });
    expect(r.status).toBe(401);
  });

  it('carries sources[] / evidence[] / origin for the caller\'s own prospect', async () => {
    const r = await invoke(leadsRoute, { as: 'A', query: { company_id: CO_A } });
    expect(r.status).toBe(200);
    expect(r.body.provenance).toBe('ok');
    expect(r.body.truncated).toBe(false);
    expect(r.body.rows).toHaveLength(1);
    const row = r.body.rows[0];
    expect(row.sourceRef).toMatchObject({ table: 'canonical_leads', id: LEAD_A });
    expect(row.provenanceStatus).toBe('loaded');
    expect(row.sources.map((c: { id: string }) => c.id)).toEqual(['psc-a']);
    expect(row.origin).toMatchObject({ category: 'community', platform: 'reddit' });
    expect(row.evidence).toEqual([expect.objectContaining({ kind: 'source_url', ref: 'https://reddit.com/r/a/1' })]);
    expect(row.scores).toMatchObject({ total: 0.4, scale: 'unit' });
  });

  it('never returns another tenant\'s contributions — even ones naming this tenant\'s lead id', async () => {
    const r = await invoke(leadsRoute, { as: 'A', query: { company_id: CO_A } });
    expect(leaksB(r.body)).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain('psc-b');
  });

  it('refuses a caller asking for a company they do not belong to', async () => {
    const r = await invoke(leadsRoute, { as: 'A', query: { company_id: CO_B } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBe(403);
    expect(leaksB(r.body)).toBe(false);
  });
});

describe('GET /api/lead-intelligence/stats — per-origin breakdown', () => {
  it('401 without a session', async () => {
    expect((await invoke(statsRoute, { query: { company_id: CO_A } })).status).toBe(401);
  });

  it('keeps bySource and adds byOriginCategory for the caller\'s tenant only', async () => {
    const r = await invoke(statsRoute, { as: 'A', query: { company_id: CO_A } });
    expect(r.status).toBe(200);
    expect(r.body.bySource).toEqual({ community: 1 });
    expect(r.body.byOriginCategory).toEqual({ community: 1 });
    expect(r.body.provenance).toBe('ok');
  });

  it('refuses a cross-tenant request', async () => {
    const r = await invoke(statsRoute, { as: 'A', query: { company_id: CO_B } });
    expect(r.status).toBe(403);
  });
});

describe('GET /api/lead-intelligence/export — provenance columns', () => {
  it('401 without a session', async () => {
    expect((await invoke(exportRoute, { query: { company_id: CO_A } })).status).toBe(401);
  });

  it('exports the provenance columns for the caller\'s tenant, never B\'s', async () => {
    const r = await invoke(exportRoute, { as: 'A', query: { company_id: CO_A } });
    expect(r.status).toBe(200);
    const body = String(r.body);
    expect(body.split('\n')[0]).toContain('origin_category,origin_platform,origin_observed_at,origin_source_url,contributors,provenance_status');
    expect(body).toContain('originating:community/reddit@2026-10-01T09:00:00+00:00');
    expect(body).not.toContain(CANARY_B);
  });

  it('refuses a cross-tenant export', async () => {
    const r = await invoke(exportRoute, { as: 'A', query: { company_id: CO_B } });
    expect(r.status).toBe(403);
    expect(String(r.body ?? '')).not.toContain(CANARY_B);
  });
});
